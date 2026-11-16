import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Вход, выход, сброс пароля учителем и отчёт по группе — на подменах (без базы и Next.js).
  Аудит 2026-11-08: № 5/36 (тексты и логи лимитов), № 12 (сброс пароля снимает счётчик логина),
  № 33 (выход только на этом устройстве), № 28 (отчёт считает только текущие шаги урока).
*/

delete process.env.STUDENT_EMAIL_DOMAIN;

class RedirectSignal extends Error {
  constructor(to) {
    super(`redirect ${to}`);
    this.to = to;
  }
}

/** Подмена console.warn на время fn: возвращает записанные вызовы. */
async function captureWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function loadLogin({ allow = { "login-ip": true, "login-account": true }, signIn = { status: 200 } } = {}) {
  const calls = { take: [], reset: [], signOut: [] };
  const supabase = {
    auth: {
      signInWithPassword: async () =>
        signIn.status === 200
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: { status: signIn.status, code: signIn.code } },
      signOut: async (options) => {
        calls.signOut.push(options);
        return { error: null };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "student", disabled: false } }) }) }),
    }),
  };
  const actions = importTsWith("@/app/(platform)/login/actions", {
    "next/headers": { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) },
    "next/navigation": {
      redirect: (to) => {
        throw new RedirectSignal(to);
      },
    },
    "@/lib/server/env": { isSupabaseConfigured: () => true, studentEmailDomain: () => "students.example.com" },
    "@/lib/server/dal/auth": { homePath: () => "/app" },
    "@/lib/server/supabase/server": { createClient: async () => supabase },
    "@/lib/server/rate-limit": (loadReal) => ({
      LOGIN_LIMITS: loadReal("@/lib/server/rate-limit").LOGIN_LIMITS,
      takeAttempt: async (rule, value) => {
        calls.take.push([rule.purpose, value]);
        return allow[rule.purpose];
      },
      resetAttempts: async (rule, value) => {
        calls.reset.push([rule.purpose, value]);
      },
    }),
  });
  return { actions, calls };
}

test("вход: свой лимит — честный текст про 15 минут и warn без логина", async () => {
  const { actions } = loadLogin({ allow: { "login-ip": true, "login-account": false } });
  let result;
  const warns = await captureWarn(async () => {
    result = await actions.login(null, form({ login: "md1-lisa", password: "x" }));
  });
  assert.match(result.error, /до 15 минут/);
  assert.match(result.error, /ведущего/);
  assert.doesNotMatch(result.error, /пару минут/);
  assert.equal(warns.length, 1);
  assert.deepEqual(warns[0][1], { purpose: "login-account" });
  assert.doesNotMatch(JSON.stringify(warns), /md1-lisa|203\.0\.113/);
});

test("вход: лимит по IP — warn называет счётчик IP, логин не считается", async () => {
  const { actions, calls } = loadLogin({ allow: { "login-ip": false, "login-account": true } });
  const warns = await captureWarn(() => actions.login(null, form({ login: "md1-lisa", password: "x" })));
  assert.deepEqual(warns[0][1], { purpose: "login-ip" });
  assert.deepEqual(
    calls.take.map(([purpose]) => purpose),
    ["login-ip"],
  );
});

test("вход: 429 от Supabase Auth — отдельный текст и warn с кодом", async () => {
  const { actions } = loadLogin({ signIn: { status: 429, code: "over_request_rate_limit" } });
  let result;
  const warns = await captureWarn(async () => {
    result = await actions.login(null, form({ login: "md1-lisa", password: "x" }));
  });
  assert.equal(result.error, "Сервер входа перегружен. Подождите минуту и попробуйте снова.");
  assert.deepEqual(warns[0][1], { code: "over_request_rate_limit" });
});

test("вход: неверный пароль — прежний общий текст, без warn", async () => {
  const { actions } = loadLogin({ signIn: { status: 400, code: "invalid_credentials" } });
  let result;
  const warns = await captureWarn(async () => {
    result = await actions.login(null, form({ login: "md1-lisa", password: "x" }));
  });
  assert.equal(result.error, "Логин или пароль неверны.");
  assert.equal(warns.length, 0);
});

test("выход: только на этом устройстве (scope local)", async () => {
  const { actions, calls } = loadLogin();
  await assert.rejects(() => actions.logout(), (error) => error instanceof RedirectSignal && error.to === "/login");
  assert.deepEqual(calls.signOut, [{ scope: "local" }]);
});

test("сброс пароля учителем снимает счётчик логина тем же ключом, что у входа", async () => {
  const resets = [];
  const loginKeys = [];
  const actions = importTsWith("@/app/(platform)/teach/actions", {
    "next/cache": { refresh: () => {} },
    "next/navigation": { redirect: () => {} },
    "@/lib/server/env": (loadReal) => ({
      ...loadReal("@/lib/server/env"),
      studentEmailDomain: () => "students.example.com",
    }),
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/wallet": { grantStars: async () => {} },
    "@/lib/server/dal/auth": {
      AuthError: class AuthError extends Error {},
      STAFF_ROLES: ["teacher"],
      authorize: async () => ({ id: "t1", role: "teacher" }),
    },
    "@/lib/server/dal/teacher": {
      assertTeachesGroup: async () => {},
      assertTeachesStudent: async () => ({
        student: { id: "s1", login: "md1-lisa", groupId: "g1", consentAt: null },
        group: { id: "g1" },
      }),
    },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({ auth: { admin: { updateUserById: async () => ({ error: null }) } } }),
    },
    "@/lib/server/rate-limit": (loadReal) => ({
      LOGIN_LIMITS: loadReal("@/lib/server/rate-limit").LOGIN_LIMITS,
      takeAttempt: async () => true,
      resetAttempts: async (rule, value) => {
        resets.push([rule.purpose, value]);
      },
    }),
  });
  const result = await actions.resetStudentPassword(null, form({ studentId: "8f0d2a5e-3c1b-4f6a-9d7e-2b4c6a8e0f13" }));
  assert.equal(result.ok, true, JSON.stringify(result));

  // ключ, который использует вход для того же логина
  const { actions: login, calls } = loadLogin({ allow: { "login-ip": true, "login-account": false } });
  await captureWarn(() => login.login(null, form({ login: "MD1-Lisa ", password: "x" })));
  for (const [purpose, value] of calls.take) if (purpose === "login-account") loginKeys.push(value);

  assert.deepEqual(resets, [["login-account", loginKeys[0]]]);
});

test("отчёт группы: шаги под старыми id заданий не считаются", async () => {
  const rows = [
    { user_id: "s1", lesson_id: "lesson-1", step: "theory" },
    { user_id: "s1", lesson_id: "lesson-1", step: "l1-new" },
    { user_id: "s1", lesson_id: "lesson-1", step: "l1-old-renamed" },
    { user_id: "s1", lesson_id: "lesson-1", step: "quiz" },
    { user_id: "s1", lesson_id: "lesson-2", step: "l2-gone" },
    { user_id: "s1", lesson_id: "lesson-9", step: "theory" },
  ];
  const query = (table) => {
    const builder = {
      select: () => builder,
      in: () => builder,
      order: () => builder,
      range: async () => ({ data: table === "lesson_progress" ? rows : [], error: null }),
    };
    return builder;
  };
  const steps = { "lesson-1": ["theory", "l1-new", "quiz", "homework"], "lesson-2": ["theory", "l2-now", "homework"] };
  const reports = importTsWith("@/lib/server/group-reports", {
    "@/lib/server/course": {
      listLessons: () => [
        { id: "lesson-1", n: 1, title: "Один" },
        { id: "lesson-2", n: 2, title: "Два" },
      ],
      lessonProgressSteps: (id) => steps[id] ?? [],
    },
    "@/lib/server/dal/auth": { AuthError: class AuthError extends Error {}, isStaff: () => true },
    "@/lib/server/dal/teacher": {
      listStudents: async () => [{ id: "s1", login: "md1-lisa", nickname: "Лиса", balance: 5 }],
    },
    "@/lib/server/supabase/server": { createClient: async () => ({ from: query }) },
  });
  const report = await reports.getGroupReport({ id: "t1", role: "teacher" }, "g1");
  assert.deepEqual(
    report.lessons.map((l) => l.steps),
    [4, 3],
  );
  assert.deepEqual(report.students[0].progress, { "lesson-1": 3 });
});
