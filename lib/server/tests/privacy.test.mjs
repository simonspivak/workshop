import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Личные данные (аудит 2026-11-08, № 23, 25, 55, 57, 58) на подменах, без базы и Next.js:
  удаление данных ученика (порядок: файлы → SQL → вход), сроки хранения в ночном обходе,
  способ согласия и «было → стало» в журнале, общая галерея admin-клиентом, засчитанный балл
  теста при сменённом ключе, курс только ученику с группой. SQL — supabase/tests/012_privacy.test.sql.
*/

class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Без шума в выводе тестов: маршрут пишет счётчики в console.info / console.error. */
async function quiet(fn) {
  const { info, error } = console;
  console.info = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.info = info;
    console.error = error;
  }
}
const STUDENT = "8f0d2a5e-3c1b-4f6a-9d7e-2b4c6a8e0f13";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const GROUP = "0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";

// ---------- № 23: удалить данные ученика ----------

/** Подменённый admin-клиент: таблицы, Storage, RPC и Auth пишут вызовы в общий журнал. */
function fakeAdmin({ role = "student", jobs = [], homework = [], listed = {}, removeError = null, rpc, bot = null, authError = null } = {}) {
  const log = [];
  const query = (table) => {
    const filters = [];
    const builder = {
      select: () => builder,
      eq: (col, value) => (filters.push([col, value]), builder),
      order: () => builder,
      range: async (from) => {
        if (from > 0) return { data: [], error: null };
        if (table === "jobs") return { data: jobs, error: null };
        if (table === "homework_submissions") return { data: homework, error: null };
        return { data: [], error: null };
      },
      maybeSingle: async () => {
        if (table === "profiles") return { data: { id: STUDENT, role }, error: null };
        if (table === "bots") return { data: bot, error: null };
        return { data: null, error: null };
      },
    };
    return builder;
  };
  const client = {
    from: (table) => query(table),
    storage: {
      from: () => ({
        list: async (folder) => ({ data: listed[folder] ?? [], error: null }),
        remove: async (paths) => {
          log.push(["remove", paths]);
          return { data: [], error: removeError };
        },
      }),
    },
    rpc: async (name, args) => {
      log.push(["rpc", name, args]);
      return rpc ? rpc(name, args) : { data: [{ jobs: 2, homework: 1, bot_messages: 3, bot_leads: 1, auth_deleted: true }], error: null };
    },
    auth: {
      admin: {
        deleteUser: async (id) => {
          log.push(["deleteUser", id]);
          return { error: authError };
        },
      },
    },
  };
  return { client, log };
}

function loadStudentData(options) {
  const admin = fakeAdmin(options);
  const forgotten = [];
  const webhooks = [];
  const mod = importTsWith("@/lib/server/student-data", {
    "@/lib/server/supabase/admin": { createAdminClient: () => admin.client },
    "@/lib/server/storage": { forgetSignedUrls: (paths) => forgotten.push(...paths) },
    "@/lib/server/bot/telegram": {
      deleteWebhook: async (token) => {
        webhooks.push(token);
        return { ok: true, result: true };
      },
    },
    "@/lib/server/crypto": { decryptSecret: (secret) => `token:${secret.ciphertext}` },
  });
  return { mod, log: admin.log, forgotten, webhooks };
}

test("пути ученика: только из его папки, без «..», без повторов, библиотека и чужие не попадают", async () => {
  const { mod } = loadStudentData();
  const paths = mod.studentPaths(
    STUDENT,
    [
      { storage_path: `${STUDENT}/a.png`, extra_paths: [`${STUDENT}/a-2.png`] },
      { storage_path: "library/motion/dance.mp4", extra_paths: [] },
      { storage_path: `${OTHER}/b.png`, extra_paths: null },
      { storage_path: null, extra_paths: [] },
    ],
    [{ storage_path: `${STUDENT}/homework/h1.pdf` }, { storage_path: null }],
    [`${STUDENT}/a.png`, `${STUDENT}/orphan.mp4`, `${STUDENT}/../${OTHER}/x.png`],
  );
  assert.deepEqual(paths, [`${STUDENT}/a.png`, `${STUDENT}/a-2.png`, `${STUDENT}/homework/h1.pdf`, `${STUDENT}/orphan.mp4`]);
});

test("удаление: сначала файлы, потом вебхук и SQL от имени админа, кеш ссылок очищен", async () => {
  const { mod, log, forgotten, webhooks } = loadStudentData({
    jobs: [{ storage_path: `${STUDENT}/j1.mp4`, extra_paths: [] }],
    homework: [{ storage_path: `${STUDENT}/homework/h1.docx` }],
    listed: { [STUDENT]: [{ id: "f1", name: "j1.mp4" }, { id: null, name: "homework" }] },
    bot: { id: "bot1", telegram_token_ciphertext: "c", telegram_token_iv: "i", telegram_token_tag: "t" },
  });
  const result = await mod.deleteStudentData("admin-1", STUDENT);
  assert.deepEqual(result, { ok: true, files: 2, jobs: 2, homework: 1, botMessages: 3, botLeads: 1 });
  assert.deepEqual(log, [
    ["remove", [`${STUDENT}/j1.mp4`, `${STUDENT}/homework/h1.docx`]],
    ["rpc", "delete_student_data", { p_actor: "admin-1", p_user: STUDENT, p_files: 2 }],
  ]);
  assert.deepEqual(forgotten, [`${STUDENT}/j1.mp4`, `${STUDENT}/homework/h1.docx`]);
  assert.deepEqual(webhooks, ["token:c"]);
});

test("удаление: Storage не удалил файлы — база не тронута, можно повторить", async () => {
  const { mod, log } = loadStudentData({
    jobs: [{ storage_path: `${STUDENT}/j1.mp4`, extra_paths: [] }],
    removeError: { message: "boom" },
  });
  assert.deepEqual(await quiet(() => mod.deleteStudentData("admin-1", STUDENT)), { ok: false, error: "delete_files_failed" });
  assert.equal(log.filter(([kind]) => kind === "rpc").length, 0);
});

test("удаление: без прав на auth.users вход удаляется через Auth Admin API", async () => {
  const { mod, log } = loadStudentData({
    rpc: () => ({ data: [{ jobs: 0, homework: 0, bot_messages: 0, bot_leads: 0, auth_deleted: false }], error: null }),
  });
  const result = await mod.deleteStudentData("admin-1", STUDENT);
  assert.equal(result.ok, true);
  assert.deepEqual(log.at(-1), ["deleteUser", STUDENT]);
});

test("удаление: не ученик и отказ SQL — без удаления", async () => {
  const teacher = loadStudentData({ role: "teacher" });
  assert.deepEqual(await teacher.mod.deleteStudentData("admin-1", STUDENT), { ok: false, error: "forbidden" });
  assert.equal(teacher.log.length, 0);
  const refused = loadStudentData({ rpc: () => ({ data: null, error: { message: "forbidden", code: "P0001" } }) });
  assert.deepEqual(await refused.mod.deleteStudentData("teacher-1", STUDENT), { ok: false, error: "forbidden" });
});

function loadDeleteAction({ role = "admin", login = "g91-tova" } = {}) {
  const calls = [];
  const action = importTsWith("@/app/(platform)/teach/student-data", {
    "next/cache": { refresh: () => calls.push(["refresh"]) },
    "@/lib/server/dal/auth": {
      AuthError,
      authorize: async (roles) => {
        if (!roles.includes(role)) throw new AuthError("forbidden");
        return { id: "admin-1", role };
      },
    },
    "@/lib/server/dal/teacher": {
      assertTeachesStudent: async (_user, id) => ({ student: { id, login, nickname: "Това" }, group: { id: GROUP } }),
    },
    "@/lib/server/student-data": {
      deleteStudentData: async (actor, id) => {
        calls.push(["delete", actor, id]);
        return { ok: true, files: 4, jobs: 1, homework: 0, botMessages: 0, botLeads: 0 };
      },
    },
  });
  return { action, calls };
}

test("кнопка удаления: только админ и только с логином ученика", async () => {
  const wrong = loadDeleteAction();
  const mismatch = await wrong.action.deleteStudentDataAction(null, form({ studentId: STUDENT, confirm: "g91-zeev" }));
  assert.equal(mismatch.error, "delete_confirm");
  assert.equal(wrong.calls.length, 0);

  const teacher = loadDeleteAction({ role: "teacher" });
  assert.deepEqual(await teacher.action.deleteStudentDataAction(null, form({ studentId: STUDENT, confirm: "g91-tova" })), {
    ok: false,
    error: "forbidden",
  });
  assert.equal(teacher.calls.length, 0);

  const ok = loadDeleteAction();
  assert.deepEqual(await ok.action.deleteStudentDataAction(null, form({ studentId: STUDENT, confirm: " G91-Tova " })), {
    ok: true,
    files: 4,
  });
  assert.deepEqual(ok.calls, [["delete", "admin-1", STUDENT], ["refresh"]]);
});

// ---------- № 23: сроки хранения в ночном обходе ----------

test("сроки хранения: числа из lib/platform/retention.ts и предел строк уходят в SQL", async () => {
  const calls = [];
  const mod = importTsWith("@/lib/server/retention", {
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { data: [{ messages: 12, leads: 3 }], error: null };
        },
      }),
    },
  });
  assert.deepEqual(await mod.sweepBotGuestData(), { botMessages: 12, botLeads: 3 });
  assert.deepEqual(calls, [["sweep_bot_guest_data", { p_message_days: 30, p_lead_days: 30, p_limit: 5000 }]]);
});

function loadSweepRoute({ retention, jobs }) {
  const order = [];
  class ConfigError extends Error {}
  const route = importTsWith("@/app/api/jobs/sweep/route", {
    "@/lib/server/env": { ConfigError },
    "@/lib/server/job-sweep": {
      checkSweepAccess: () => "ok",
      sweepJobs: async () => {
        order.push("jobs");
        return jobs;
      },
    },
    "@/lib/server/retention": {
      sweepBotGuestData: async () => {
        order.push("retention");
        return retention();
      },
    },
  });
  return { route, order };
}

const request = { headers: new Headers({ authorization: "Bearer x" }) };


const JOBS = { checked: 1, done: 1, failed: 0, storing: 0, unchanged: 0, errors: 0, skipped: 0 };

test("ночной обход: чистка гостевых данных до задач, счётчики в ответе", async () => {
  const { route, order } = loadSweepRoute({ retention: () => ({ botMessages: 7, botLeads: 2 }), jobs: JOBS });
  const response = await quiet(() => route.GET(request));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ...JOBS, botMessages: 7, botLeads: 2 });
  assert.deepEqual(order, ["retention", "jobs"]);
});

test("ночной обход: сбой чистки не останавливает задачи", async () => {
  const { route, order } = loadSweepRoute({
    retention: () => {
      throw new Error("db down");
    },
    jobs: JOBS,
  });
  const response = await quiet(() => route.POST(request));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ...JOBS, botMessages: null, botLeads: null });
  assert.deepEqual(order, ["retention", "jobs"]);
});

// ---------- № 25: согласие родителей ----------

function loadTeachActions(student) {
  const calls = { update: [], audit: [] };
  const actions = importTsWith("@/app/(platform)/teach/actions", {
    "next/cache": { refresh: () => {} },
    "next/navigation": { redirect: () => {} },
    "@/lib/server/audit": { audit: async (entry) => calls.audit.push(entry) },
    "@/lib/server/wallet": { grantStars: async () => {}, grantStarsToGroup: async () => {} },
    "@/lib/server/dal/auth": { AuthError, STAFF_ROLES: ["teacher"], authorize: async () => ({ id: "t1", role: "teacher" }) },
    "@/lib/server/dal/teacher": {
      assertTeachesGroup: async (_user, groupId) => ({ id: groupId, code: "g91" }),
      assertTeachesStudent: async () => ({ student, group: { id: GROUP } }),
    },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        from: () => ({
          update: (values) => ({
            eq: async () => {
              calls.update.push(values);
              return { error: null };
            },
          }),
        }),
      }),
    },
  });
  return { actions, calls };
}

const NO_CONSENT = { id: STUDENT, login: "g91-tova", groupId: GROUP, ageBand: "u16", consentAt: null, consentMethod: null, consentBy: null };

test("согласие: отмечено — дата, способ и кто; в журнале «было → стало» без данных родителей", async () => {
  const { actions, calls } = loadTeachActions(NO_CONSENT);
  const result = await actions.updateStudentAge(
    null,
    form({ studentId: STUDENT, ageBand: "16_17", consent: "on", consentMethod: "paper_centre" }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const [values] = calls.update;
  assert.equal(values.age_band, "16_17");
  assert.equal(values.parental_consent_method, "paper_centre");
  assert.equal(values.parental_consent_by, "t1");
  assert.match(values.parental_consent_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls.audit[0].meta, {
    from: { ageBand: "u16", consent: false, consentMethod: null },
    to: { ageBand: "16_17", consent: true, consentMethod: "paper_centre" },
  });
});

test("согласие: тот же способ — дату и «кто» не трогаем; снято — всё пусто; без способа — ошибка поля", async () => {
  const consented = { ...NO_CONSENT, consentAt: "2026-11-05T10:00:00.000Z", consentMethod: "paper_centre", consentBy: "t0" };
  const same = loadTeachActions(consented);
  await same.actions.updateStudentAge(null, form({ studentId: STUDENT, ageBand: "u16", consent: "on", consentMethod: "paper_centre" }));
  assert.deepEqual(same.calls.update, [{ age_band: "u16" }]);

  const changed = loadTeachActions(consented);
  await changed.actions.updateStudentAge(
    null,
    form({ studentId: STUDENT, ageBand: "u16", consent: "on", consentMethod: "electronic_centre" }),
  );
  assert.deepEqual(changed.calls.update, [
    {
      age_band: "u16",
      parental_consent_at: "2026-11-05T10:00:00.000Z",
      parental_consent_method: "electronic_centre",
      parental_consent_by: "t1",
    },
  ]);

  const off = loadTeachActions(consented);
  await off.actions.updateStudentAge(null, form({ studentId: STUDENT, ageBand: "u16" }));
  assert.deepEqual(off.calls.update, [
    { age_band: "u16", parental_consent_at: null, parental_consent_method: null, parental_consent_by: null },
  ]);

  const missing = loadTeachActions(NO_CONSENT);
  const bad = await missing.actions.updateStudentAge(null, form({ studentId: STUDENT, ageBand: "u16", consent: "on" }));
  assert.equal(bad.error, "invalid_input");
  assert.ok(bad.fields.consentMethod);
  assert.equal(missing.calls.update.length, 0);
});

// ---------- № 57: общая галерея — admin-клиентом ----------

test("общая галерея ученика читается admin-клиентом с фильтрами группы, свои — клиентом пользователя", async () => {
  const used = [];
  const client = (name) => {
    const builder = {
      select: () => builder,
      eq: (col, value) => (used.push([name, "eq", col, value]), builder),
      neq: () => builder,
      is: () => builder,
      in: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      returns: async () => ({ data: [], error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return { from: (table) => (used.push([name, "from", table]), builder) };
  };
  const gallery = importTsWith("@/lib/server/gallery", {
    "@/lib/server/supabase/admin": { createAdminClient: () => client("admin") },
    "@/lib/server/supabase/server": { createClient: async () => client("user") },
    "@/lib/server/job-progress": { JOB_COLUMNS: "id", toJobViews: async () => [] },
    "@/lib/server/storage": { forgetSignedUrls: () => {}, listLibrary: async () => [], MOTION_LIBRARY_FOLDER: "x", signMediaPaths: async () => new Map() },
    "@/lib/server/studio": { lineText: () => "" },
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/dal/teacher": { assertTeachesGroup: async () => ({}), isUuid: () => true },
    "@/lib/server/dal/auth": { AuthError, isStaff: (u) => u.role !== "student" },
  });
  const student = { id: STUDENT, role: "student", group: { id: GROUP, shareGallery: true } };
  await gallery.listSharedGroupGallery(student);
  assert.deepEqual(used.slice(0, 2), [
    ["admin", "from", "jobs"],
    ["admin", "eq", "group_id", GROUP],
  ]);
  used.length = 0;
  await gallery.listReferenceOptions(student);
  assert.deepEqual(
    used.filter(([, kind]) => kind === "from"),
    [
      ["user", "from", "jobs"],
      ["admin", "from", "jobs"],
    ],
  );
  assert.equal(await gallery.listSharedGroupGallery({ ...student, group: { id: GROUP, shareGallery: false } }), null);
});

// ---------- № 55: засчитанный балл теста ----------

function loadLessonProgress(key) {
  return importTsWith("@/lib/server/lesson-progress", {
    "@/lib/server/course": { getQuizKey: () => key, lessonProgressSteps: () => [] },
    "@/lib/server/job-progress": { JOB_COLUMNS: "id", toJobViews: async () => [] },
    "@/lib/server/supabase/admin": { createAdminClient: () => ({}) },
    "@/lib/server/supabase/server": { createClient: async () => ({}) },
  });
}

const KEY = [0, 1, 2].map((correctIndex) => ({ correctIndex, explanation: `q${correctIndex}`, optionCount: 4 }));

test("тест: ключ не менялся — засчитанный балл и разбор", () => {
  const result = loadLessonProgress(KEY).recordedQuizResult("lesson-1", [0, 1, 3], 2, 3, 0);
  assert.equal(result.keyChanged, false);
  assert.equal(result.score, 2);
  assert.equal(result.items.length, 3);
});

test("тест: ключ поменяли после попытки — балл как засчитан, разбора нет", () => {
  const changed = KEY.map((item, i) => (i === 0 ? { ...item, correctIndex: 3 } : item));
  const result = loadLessonProgress(changed).recordedQuizResult("lesson-1", [0, 1, 3], 2, 3, 20);
  assert.deepEqual(
    { score: result.score, bonus: result.bonus, keyChanged: result.keyChanged, items: result.items },
    { score: 2, bonus: 20, keyChanged: true, items: [] },
  );
  const fewer = loadLessonProgress(KEY.slice(0, 2)).recordedQuizResult("lesson-1", [0, 1, 3], 2, 3, 0);
  assert.equal(fewer.keyChanged, true);
});

// ---------- № 58: курс только ученику с группой ----------

test("курс: ученику без группы — нет, ведущему и админу группа не нужна", () => {
  const auth = importTsWith("@/lib/server/dal/auth", {
    "next/headers": { cookies: async () => ({}) },
    "next/server": { connection: async () => {} },
    "next/navigation": { redirect: () => {} },
    "@/lib/server/env": { isSupabaseConfigured: () => false },
    "@/lib/server/supabase/server": { createClient: async () => ({}) },
  });
  assert.equal(auth.hasCourseAccess({ role: "student", group: null }), false);
  assert.equal(auth.hasCourseAccess({ role: "student", group: { id: GROUP } }), true);
  assert.equal(auth.hasCourseAccess({ role: "teacher", group: null }), true);
  assert.equal(auth.hasCourseAccess({ role: "admin", group: null }), true);
});
