import assert from "node:assert/strict";
import { importTs, importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Кабинет ведущего — на подменах (без базы и Next.js). Аудит 2026-11-08:
  № 14/15 (суммы звёзд и отчёт считает SQL, сервер передаёт кто вызывает), № 28 (отчёт — только
  текущие шаги урока), № 42 (постраничное чтение не зависит от Max Rows), № 26 (отключить ученика),
  № 27 (начислить всей группе), № 29 (карточки нескольких пачек), № 30 (порядок, фильтры, CSV),
  № 51 (предупреждения бюджета). Сами SQL-функции — supabase/tests/010_teacher_aggregates.test.sql.
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

const GROUP = "0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const STUDENT = "8f0d2a5e-3c1b-4f6a-9d7e-2b4c6a8e0f13";

// ---------- № 14: карточка «Звёзды группы» ----------

function loadTeacherDal(rpc) {
  const calls = [];
  const dal = importTsWith("@/lib/server/dal/teacher", {
    "@/lib/server/dal/auth": { AuthError, isStaff: (u) => u.role === "teacher" || u.role === "admin" },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return rpc(name, args);
        },
      }),
    },
    "@/lib/server/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/prices": { getPriceList: async () => [] },
  });
  return { dal, calls };
}

test("звёзды группы: одна строка сумм из SQL, кто вызывает — в p_actor", async () => {
  const { dal, calls } = loadTeacherDal(() => ({ data: [{ given: "5400", handed: "5200", spent: "1290" }], error: null }));
  const stats = await dal.getGroupStarStats({ id: "t1", role: "teacher" }, GROUP);
  assert.deepEqual(stats, { given: 5400, handed: 5200, spent: 1290 });
  assert.deepEqual(calls, [["group_star_stats", { p_actor: "t1", p_group: GROUP }]]);
});

test("звёзды группы: forbidden из SQL — AuthError, ученику — без запроса", async () => {
  const { dal, calls } = loadTeacherDal(() => ({ data: null, error: { message: "forbidden", code: "P0001" } }));
  await assert.rejects(
    () => dal.getGroupStarStats({ id: "t2", role: "teacher" }, GROUP),
    (error) => error instanceof AuthError && error.code === "forbidden",
  );
  await assert.rejects(() => dal.getGroupStarStats({ id: "s1", role: "student" }, GROUP), AuthError);
  assert.equal(calls.length, 1);
});

// ---------- № 15, 28: отчёт группы ----------

function loadReports({ progress = [], spending = [], quiz = [], forbidden = false } = {}) {
  const calls = { rpc: [], asserted: [] };
  const steps = { "lesson-1": ["theory", "l1-new", "quiz", "homework"], "lesson-2": ["theory", "l2-now", "homework"] };
  const quizQuery = () => {
    const builder = {
      select: () => builder,
      in: () => builder,
      order: () => builder,
      range: async (from) => ({ data: from === 0 ? quiz : [], error: null }),
    };
    return builder;
  };
  const reports = importTsWith("@/lib/server/group-reports", {
    "@/lib/server/course": {
      listLessons: () => [
        { id: "lesson-1", n: 1, title: "Один" },
        { id: "lesson-2", n: 2, title: "Два" },
      ],
      lessonProgressSteps: (id) => steps[id] ?? [],
    },
    "@/lib/server/dal/auth": { AuthError, isStaff: () => true },
    "@/lib/server/dal/teacher": (loadReal) => ({
      teacherRpcError: loadReal("@/lib/server/dal/teacher").teacherRpcError,
      assertTeachesGroup: async (user, groupId) => {
        calls.asserted.push([user.id, groupId]);
      },
      listStudents: async () => [
        { id: "s1", login: "md1-lisa", nickname: "Лиса", balance: 5 },
        { id: "s2", login: "md1-ezh", nickname: "Ёж", balance: 0 },
      ],
    }),
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.rpc.push([name, args]);
          if (forbidden) return { data: null, error: { message: "forbidden", code: "P0001" } };
          return { data: name === "group_report_progress" ? progress : spending, error: null };
        },
      }),
    },
    "@/lib/server/supabase/server": { createClient: async () => ({ from: quizQuery }) },
  });
  return { reports, calls };
}

test("отчёт группы: SQL получает пары (урок, шаг) текущей версии уроков", async () => {
  const { reports, calls } = loadReports({ progress: [{ user_id: "s1", lesson_id: "lesson-1", steps: 3 }] });
  const report = await reports.getGroupReport({ id: "t1", role: "teacher" }, GROUP);
  assert.deepEqual(calls.asserted, [["t1", GROUP]]);
  const progressCall = calls.rpc.find(([name]) => name === "group_report_progress");
  assert.deepEqual(progressCall[1], {
    p_actor: "t1",
    p_group: GROUP,
    p_lessons: ["lesson-1", "lesson-1", "lesson-1", "lesson-1", "lesson-2", "lesson-2", "lesson-2"],
    p_steps: ["theory", "l1-new", "quiz", "homework", "theory", "l2-now", "homework"],
  });
  assert.deepEqual(
    report.lessons.map((l) => l.steps),
    [4, 3],
  );
  assert.deepEqual(report.students[0].progress, { "lesson-1": 3 });
  assert.deepEqual(report.students[1].progress, {});
});

test("отчёт группы: траты по ученику и итоги из SQL, тесты и бонусы", async () => {
  const { reports } = loadReports({
    spending: [{ user_id: "s1", spent_total: "1150", spent_today: "30", generations: 1200, refunds: 50, bot_replies: 0 }],
    quiz: [{ id: 1, user_id: "s2", lesson_id: "lesson-1", score: 9, max_score: 10, bonus: 20 }],
  });
  const report = await reports.getGroupReport({ id: "t1", role: "teacher" }, GROUP);
  assert.deepEqual(report.students[0].spent, { total: 1150, today: 30, generations: 1200, refunds: 50, botReplies: 0 });
  assert.deepEqual(report.students[1].spent, { total: 0, today: 0, generations: 0, refunds: 0, botReplies: 0 });
  assert.deepEqual(report.totals, { spentToday: 30, spentTotal: 1150, quizBonus: 20 });
  assert.equal(report.students[1].quiz["lesson-1"].score, 9);
});

test("отчёт группы: forbidden из SQL — AuthError", async () => {
  const { reports } = loadReports({ forbidden: true });
  await assert.rejects(
    () => reports.getGroupReport({ id: "t2", role: "teacher" }, GROUP),
    (error) => error instanceof AuthError && error.code === "forbidden",
  );
});

// ---------- № 42: постраничное чтение ----------

test("постраничное чтение: Max Rows меньше страницы — читаем дальше до пустой страницы", async () => {
  const { fetchAll } = importTs("@/lib/server/supabase/paging");
  const all = Array.from({ length: 1234 }, (_, i) => i);
  const asked = [];
  // сервер отдаёт не больше 500 строк, сколько бы ни попросили
  const rows = await fetchAll(async (from, to) => {
    asked.push([from, to]);
    return { data: all.slice(from, Math.min(to + 1, from + 500)), error: null };
  }, "test");
  assert.equal(rows.length, 1234);
  assert.deepEqual(rows.slice(495, 505), all.slice(495, 505));
  assert.deepEqual(
    asked.map(([from]) => from),
    [0, 500, 1000, 1234],
  );
});

test("постраничное чтение: ошибка — исключение с именем операции", async () => {
  const { fetchAll } = importTs("@/lib/server/supabase/paging");
  await assert.rejects(() => fetchAll(async () => ({ data: null, error: { code: "57014" } }), "groupReports.quiz"), /groupReports\.quiz failed \(57014\)/);
});

// ---------- № 26, 27: действия ведущего ----------

function loadActions({ rpcError = null, groupResult } = {}) {
  const calls = { rpc: [], group: [], refresh: 0 };
  const actions = importTsWith("@/app/(platform)/teach/actions", {
    "next/cache": {
      refresh: () => {
        calls.refresh++;
      },
    },
    "next/navigation": { redirect: () => {} },
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/wallet": {
      grantStars: async () => {},
      grantStarsToGroup: async (input) => {
        calls.group.push(input);
        return groupResult ?? { ok: true, affected: 2, skipped: 1, total: 200, already: false };
      },
    },
    "@/lib/server/dal/auth": { AuthError, STAFF_ROLES: ["teacher"], authorize: async () => ({ id: "t1", role: "teacher" }) },
    "@/lib/server/dal/teacher": {
      assertTeachesGroup: async (_user, groupId) => ({ id: groupId }),
      assertTeachesStudent: async (_user, studentId) => ({
        student: { id: studentId, login: "md1-lisa", groupId: GROUP, consentAt: null },
        group: { id: GROUP },
      }),
    },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.rpc.push([name, args]);
          return { data: rpcError ? null : true, error: rpcError };
        },
      }),
    },
  });
  return { actions, calls };
}

test("отключить ученика: SQL set_student_disabled от имени ведущего, страница обновляется", async () => {
  const { actions, calls } = loadActions();
  const off = await actions.setStudentDisabled(null, form({ studentId: STUDENT, disabled: "1" }));
  assert.equal(off.ok, true, JSON.stringify(off));
  const on = await actions.setStudentDisabled(null, form({ studentId: STUDENT, disabled: "0" }));
  assert.equal(on.ok, true);
  assert.deepEqual(calls.rpc, [
    ["set_student_disabled", { p_actor: "t1", p_user: STUDENT, p_disabled: true }],
    ["set_student_disabled", { p_actor: "t1", p_user: STUDENT, p_disabled: false }],
  ]);
  assert.equal(calls.refresh, 2);
});

test("отключить ученика: forbidden из SQL и неверный ввод", async () => {
  const { actions } = loadActions({ rpcError: { message: "forbidden", code: "P0001" } });
  assert.deepEqual(await actions.setStudentDisabled(null, form({ studentId: STUDENT, disabled: "1" })), {
    ok: false,
    error: "forbidden",
  });
  const bad = await actions.setStudentDisabled(null, form({ studentId: STUDENT, disabled: "yes" }));
  assert.equal(bad.error, "invalid_input");
});

test("начислить всей группе: режим, сумма и ключ формы уходят в SQL", async () => {
  const { actions, calls } = loadActions();
  const result = await actions.grantGroupStars(
    null,
    form({ groupId: GROUP, mode: "add", amount: "100", note: " урок 2 ", idempotencyKey: "key-000000001" }),
  );
  assert.deepEqual(result, { ok: true, affected: 2, skipped: 1, total: 200, already: false });
  assert.deepEqual(calls.group, [
    { actorId: "t1", groupId: GROUP, amount: 100, mode: "add", note: "урок 2", idempotencyKey: "key-000000001" },
  ]);
});

test("начислить всей группе: лимит ведущего — код grant_limit с русским текстом", async () => {
  const { errorMessages } = importTs("@/lib/platform/messages");
  const { actions } = loadActions({ groupResult: { ok: false, error: "grant_limit" } });
  const result = await actions.grantGroupStars(
    null,
    form({ groupId: GROUP, mode: "add", amount: "600", idempotencyKey: "key-000000002" }),
  );
  assert.deepEqual(result, { ok: false, error: "grant_limit" });
  assert.match(errorMessages.grant_limit, /лимит/);
});

test("начислить всей группе: «до N» только плюсом, ноль и без ключа — неверный ввод", async () => {
  const { actions, calls } = loadActions();
  for (const fields of [
    { groupId: GROUP, mode: "top_up_to", amount: "-5", idempotencyKey: "key-000000003" },
    { groupId: GROUP, mode: "add", amount: "0", idempotencyKey: "key-000000004" },
    { groupId: GROUP, mode: "add", amount: "10" },
  ]) {
    assert.equal((await actions.grantGroupStars(null, form(fields))).error, "invalid_input", JSON.stringify(fields));
  }
  assert.equal(calls.group.length, 0);
});

test("начислить всей группе: ошибка SQL grant_limit превращается в код кошелька", async () => {
  const wallet = importTsWith("@/lib/server/wallet", {
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({ rpc: async () => ({ data: null, error: { message: "grant_limit", code: "P0001" } }) }),
    },
  });
  const result = await wallet.grantStarsToGroup({ actorId: "t1", groupId: GROUP, amount: 600, mode: "add", idempotencyKey: "key-000000005" });
  assert.deepEqual(result, { ok: false, error: "grant_limit" });
});

// ---------- № 29, 30, 51: чистая логика кабинета ----------

test("несколько пачек учеников: карточки прошлых пачек остаются, ошибка их не стирает", () => {
  const { mergeCreatedBatch } = importTs("@/lib/platform/teacher-cabinet");
  const card = (login) => ({ login, nickname: login, password: "p" });
  let session = mergeCreatedBatch(null, { ok: true, created: [card("g-a"), card("g-b")], failed: [] });
  session = mergeCreatedBatch(session, { ok: false, error: "invalid_input" });
  assert.equal(session.created.length, 2);
  assert.equal(session.error.error, "invalid_input");
  session = mergeCreatedBatch(session, { ok: true, created: [card("g-c")], failed: ["Ёж"] });
  assert.deepEqual(
    session.created.map((s) => s.login),
    ["g-a", "g-b", "g-c"],
  );
  assert.deepEqual(session.failed, ["Ёж"]);
  assert.equal(session.batches, 2);
  assert.equal(session.error, null);
});

test("список учеников: по балансу — сначала у кого меньше; фильтры 0 ★ / мало / отключены", () => {
  const { sortStudents, filterStudents, countStudents } = importTs("@/lib/platform/teacher-cabinet");
  const students = [
    { login: "g-b", nickname: "Боря", balance: 40, disabled: false },
    { login: "g-a", nickname: "Аня", balance: 0, disabled: false },
    { login: "g-c", nickname: "Катя", balance: 10, disabled: true },
    { login: "g-d", nickname: "Даня", balance: 0, disabled: false },
  ];
  assert.deepEqual(
    sortStudents(students, "balance").map((s) => s.login),
    ["g-a", "g-d", "g-c", "g-b"],
  );
  assert.deepEqual(
    sortStudents(students, "nickname").map((s) => s.nickname),
    ["Аня", "Боря", "Даня", "Катя"],
  );
  assert.deepEqual(
    filterStudents(students, "low", 25).map((s) => s.login),
    [],
  );
  assert.deepEqual(
    filterStudents(students, "low", 50).map((s) => s.login),
    ["g-b"],
  );
  assert.deepEqual(countStudents(students, 50), { all: 4, zero: 2, low: 1, disabled: 1 });
  assert.equal(students[0].login, "g-b", "исходный массив не меняется");
});

test("бюджет группы: учеников больше плана, раздача сверх бюджета; бонусы тестов не считаются", () => {
  const { budgetWarnings } = importTs("@/lib/platform/teacher-cabinet");
  const base = { budgetStars: 5200, plannedStudents: 10, starsPerStudent: 520, activeStudents: 10, handed: 5200 };
  assert.deepEqual(budgetWarnings(base), []);
  const over = budgetWarnings({ ...base, activeStudents: 11, handed: 5720 });
  assert.equal(over.length, 2);
  assert.match(over[0], /больше плана: 11 из 10/);
  assert.match(over[1], /больше бюджета/);
  assert.match(budgetWarnings({ ...base, activeStudents: 11 })[1], /выйдет 5\s720 ★/);
  assert.deepEqual(budgetWarnings({ ...base, budgetStars: null, plannedStudents: null }), []);
});

test("CSV отчёта: BOM, «;», шаги числом, формулы экранированы", () => {
  const { groupReportToCsv } = importTs("@/lib/server/group-report-csv");
  const csv = groupReportToCsv({
    lessons: [{ id: "lesson-1", n: 1, title: "Один", steps: 6 }],
    students: [
      {
        id: "s1",
        login: "md1-lisa",
        nickname: "=HYPERLINK(1)",
        balance: 5,
        progress: { "lesson-1": 3 },
        quiz: { "lesson-1": { score: 9, maxScore: 10, bonus: 20 } },
        spent: { total: 100, today: 10, generations: 7, refunds: 1, botReplies: 2 },
      },
    ],
    totals: { spentToday: 10, spentTotal: 100, quizBonus: 20 },
  });
  assert.ok(csv.startsWith("﻿Ник;Логин;"));
  const [header, row] = csv.slice(1).trim().split("\r\n");
  assert.match(header, /Урок 1: шагов из 6;Урок 1: тест$/);
  assert.equal(row, "'=HYPERLINK(1);md1-lisa;5;10;100;7;1;2;3;9 из 10");
});
