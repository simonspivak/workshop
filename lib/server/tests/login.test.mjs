import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Вход, выход, сброс пароля учителем и отчёт по группе — на подменах (без базы и Next.js).
  Аудит 2026-11-08: № 5/36 (тексты и логи лимитов), № 12 (сброс пароля снимает счётчик логина),
  № 33 (выход только на этом устройстве), № 28 (отчёт считает только текущие шаги урока).
  Пакет 16 ноября: № 5 (IP считает только неудачи, 300 за 15 мин, «Снять блокировку входа»),
  № 11 (повторы при 429 Supabase, proxy не стирает cookie при 429/5xx), № 13 (опрос на 401),
  № 32 (флаги cookie), № 36 (/admin, вошедший на /login), № 59 (журнал входов ведущих).
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

/**
 * Вход на подменах. allow — что отвечают счётчики; signIn — список ответов Supabase по очереди
 * (последний повторяется); role/disabled — профиль; staffByEmail — что вернёт staff_id_by_email.
 */
function loadLogin({
  allow = { "login-ip": true, "login-account": true },
  signIn = [{ status: 200 }],
  role = "student",
  disabled = false,
  staffByEmail = null,
} = {}) {
  const calls = { reserve: [], refund: [], take: [], reset: [], signOut: [], signIn: 0, sleeps: [], audit: [], rpc: [], clientOptions: [] };
  const supabase = {
    auth: {
      signInWithPassword: async () => {
        const answer = signIn[Math.min(calls.signIn, signIn.length - 1)];
        calls.signIn++;
        return answer.status === 200
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: { status: answer.status, code: answer.code } };
      },
      signOut: async (options) => {
        calls.signOut.push(options);
        return { error: null };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, disabled } }) }) }),
    }),
  };
  let nextHit = 1;
  const actions = importTsWith("@/app/(platform)/login/actions", {
    "node:timers/promises": {
      setTimeout: async (ms) => {
        calls.sleeps.push(ms);
      },
    },
    "next/headers": { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) },
    "next/navigation": {
      redirect: (to) => {
        throw new RedirectSignal(to);
      },
    },
    "@/lib/server/env": { isSupabaseConfigured: () => true, studentEmailDomain: () => "students.example.com" },
    "@/lib/server/dal/auth": {
      homePath: (p) => (p.role === "student" ? "/app" : "/teach"),
      isStaff: (p) => p.role === "teacher" || p.role === "admin",
    },
    "@/lib/server/audit": {
      audit: async (entry) => {
        calls.audit.push(entry);
      },
    },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.rpc.push([name, args]);
          return { data: staffByEmail, error: null };
        },
      }),
    },
    "@/lib/server/supabase/server": {
      createClient: async (options) => {
        calls.clientOptions.push(options);
        return supabase;
      },
    },
    "@/lib/server/rate-limit": (loadReal) => ({
      LOGIN_LIMITS: loadReal("@/lib/server/rate-limit").LOGIN_LIMITS,
      keyFor: (purpose, value) => `${purpose}:hash(${value.length})`,
      reserveAttempt: async (rule, value) => {
        calls.reserve.push([rule.purpose, value]);
        return allow[rule.purpose] ? { purpose: rule.purpose, key: `k:${value}`, id: nextHit++ } : null;
      },
      refundAttempt: async (slot) => {
        calls.refund.push([slot.purpose, slot.id]);
      },
      takeAttempt: async (rule, value) => {
        calls.take.push([rule.purpose, value]);
        return allow[rule.purpose];
      },
      resetAttempts: async (rule, value) => {
        calls.reset.push([rule.purpose, value]);
        return true;
      },
    }),
  });
  return { actions, calls };
}

async function loginExpectRedirect(actions, fields) {
  let to = null;
  await assert.rejects(
    () => actions.login(null, form(fields)),
    (error) => {
      to = error instanceof RedirectSignal ? error.to : null;
      return to !== null;
    },
  );
  return to;
}

// ---------- № 5: лимит по IP считает только неудачи ----------

test("лимиты входа: 300 неудач с IP и 20 попыток на логин за 15 минут", async () => {
  const { LOGIN_LIMITS } = importTsWith("@/lib/server/rate-limit", {
    "@/lib/server/supabase/admin": { createAdminClient: () => ({}) },
  });
  assert.deepEqual(LOGIN_LIMITS.ip, { purpose: "login-ip", limit: 300, windowSec: 900 });
  assert.deepEqual(LOGIN_LIMITS.account, { purpose: "login-account", limit: 20, windowSec: 900 });
});

test("вход: удачный вход возвращает попытку с IP и сбрасывает счётчик логина", async () => {
  const { actions, calls } = loadLogin();
  const to = await loginExpectRedirect(actions, { login: "md1-lisa", password: "x" });
  assert.equal(to, "/app");
  assert.deepEqual(calls.reserve.map(([p]) => p), ["login-ip"]);
  assert.deepEqual(calls.refund, [["login-ip", 1]]);
  assert.deepEqual(calls.take.map(([p]) => p), ["login-account"]);
  assert.deepEqual(calls.reset.map(([p]) => p), ["login-account"]);
  assert.equal(calls.audit.length, 0, "вход ученика в журнал не пишется");
  assert.equal(calls.rpc.length, 0);
});

test("вход: 50 удачных входов с одного IP не тратят бюджет IP", async () => {
  const { actions, calls } = loadLogin();
  for (let i = 0; i < 50; i++) await loginExpectRedirect(actions, { login: `md1-s${i}`, password: "x" });
  assert.equal(calls.reserve.length, 50);
  assert.equal(calls.refund.length, 50, "каждая занятая попытка возвращена");
});

test("вход: неверный пароль — попытка с IP остаётся засчитанной, общий текст, без warn", async () => {
  const { actions, calls } = loadLogin({ signIn: [{ status: 400, code: "invalid_credentials" }] });
  let result;
  const warns = await captureWarn(async () => {
    result = await actions.login(null, form({ login: "md1-lisa", password: "x" }));
  });
  assert.equal(result.error, "Логин или пароль неверны.");
  assert.equal(warns.length, 0);
  assert.deepEqual(calls.refund, []);
  assert.deepEqual(calls.reset, []);
  assert.equal(calls.rpc.length, 0, "по техническому адресу ученика ведущего не ищем");
});

test("вход: свой лимит логина — честный текст про 15 минут, warn без логина, попытка с IP засчитана", async () => {
  const { actions, calls } = loadLogin({ allow: { "login-ip": true, "login-account": false } });
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
  assert.deepEqual(calls.refund, [], "перебор по заблокированному логину тратит бюджет IP");
  assert.equal(calls.signIn, 0);
});

test("вход: лимит по IP — warn называет счётчик IP, логин не считается", async () => {
  const { actions, calls } = loadLogin({ allow: { "login-ip": false, "login-account": true } });
  const warns = await captureWarn(() => actions.login(null, form({ login: "md1-lisa", password: "x" })));
  assert.deepEqual(warns[0][1], { purpose: "login-ip" });
  assert.deepEqual(calls.take, []);
  assert.equal(calls.signIn, 0);
});

// ---------- № 11: 429 Supabase Auth ----------

test("вход: 429 Supabase дважды, затем успех — два повтора с паузой 1,5–3 с, счётчики не тронуты", async () => {
  const { actions, calls } = loadLogin({ signIn: [{ status: 429 }, { status: 429 }, { status: 200 }] });
  const to = await loginExpectRedirect(actions, { login: "md1-lisa", password: "x" });
  assert.equal(to, "/app");
  assert.equal(calls.signIn, 3);
  assert.equal(calls.sleeps.length, 2);
  for (const ms of calls.sleeps) assert.ok(ms >= 1500 && ms <= 3000, `пауза ${ms}`);
  assert.equal(calls.reserve.length, 1, "повтор — та же попытка");
  assert.equal(calls.take.length, 1);
});

test("вход: 429 Supabase после двух повторов — текст «перегружен», warn с кодом, попытка с IP возвращена", async () => {
  const { actions, calls } = loadLogin({ signIn: [{ status: 429, code: "over_request_rate_limit" }] });
  let result;
  const warns = await captureWarn(async () => {
    result = await actions.login(null, form({ login: "md1-lisa", password: "x" }));
  });
  assert.equal(result.error, "Сервер входа перегружен. Подождите 10 секунд и нажмите «Войти» ещё раз.");
  assert.equal(calls.signIn, 3);
  assert.equal(calls.sleeps.length, 2);
  assert.deepEqual(warns[0][1], { code: "over_request_rate_limit", retries: 2 });
  assert.deepEqual(calls.refund, [["login-ip", 1]]);
});

// ---------- № 59: журнал входов ведущих ----------

test("вход ведущего: login.success с id и HMAC сети, без IP и адреса", async () => {
  const { actions, calls } = loadLogin({ role: "teacher" });
  const to = await loginExpectRedirect(actions, { login: "teacher@example.org", password: "x" });
  assert.equal(to, "/teach");
  assert.equal(calls.audit.length, 1);
  const [entry] = calls.audit;
  assert.equal(entry.action, "login.success");
  assert.equal(entry.actorId, "u1");
  assert.equal(entry.targetUser, "u1");
  assert.match(entry.meta.ip, /^audit-ip:/);
  assert.doesNotMatch(JSON.stringify(entry), /203\.0\.113|teacher@example\.org|"x"/);
});

test("неудачный вход ведущего: ищем аккаунт по адресу и пишем login.failed", async () => {
  const { actions, calls } = loadLogin({ signIn: [{ status: 400 }], staffByEmail: "t-1" });
  const result = await actions.login(null, form({ login: "Teacher@Example.org", password: "bad" }));
  assert.equal(result.error, "Логин или пароль неверны.");
  assert.deepEqual(calls.rpc, [["staff_id_by_email", { p_email: "teacher@example.org" }]]);
  assert.equal(calls.audit.length, 1);
  assert.deepEqual(
    { action: calls.audit[0].action, actorId: calls.audit[0].actorId, targetUser: calls.audit[0].targetUser, reason: calls.audit[0].meta.reason },
    { action: "login.failed", actorId: null, targetUser: "t-1", reason: "wrong" },
  );
  assert.doesNotMatch(JSON.stringify(calls.audit), /bad|teacher@example/i);
});

test("неудачный вход по чужому адресу (не ведущий) в журнал не пишется", async () => {
  const { actions, calls } = loadLogin({ signIn: [{ status: 400 }], staffByEmail: null });
  await actions.login(null, form({ login: "someone@example.org", password: "bad" }));
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.audit.length, 0);
});

test("заблокированный логин ведущего — login.failed с причиной locked", async () => {
  const { actions, calls } = loadLogin({ allow: { "login-ip": true, "login-account": false }, staffByEmail: "t-1" });
  await captureWarn(() => actions.login(null, form({ login: "teacher@example.org", password: "x" })));
  assert.equal(calls.audit[0].meta.reason, "locked");
});

test("отключённый ведущий: выход со всех устройств и login.failed disabled", async () => {
  const { actions, calls } = loadLogin({ role: "teacher", disabled: true });
  const result = await actions.login(null, form({ login: "teacher@example.org", password: "x" }));
  assert.match(result.error, /отключён/);
  assert.deepEqual(calls.signOut, [{ scope: "global" }]);
  assert.equal(calls.audit[0].action, "login.failed");
  assert.equal(calls.audit[0].meta.reason, "disabled");
});

// ---------- выход и сброс ----------

test("выход: только на этом устройстве (scope local), клиенту разрешено удалить cookie", async () => {
  const { actions, calls } = loadLogin();
  await assert.rejects(() => actions.logout(), (error) => error instanceof RedirectSignal && error.to === "/login");
  assert.deepEqual(calls.signOut, [{ scope: "local" }]);
  assert.deepEqual(calls.clientOptions, [{ allowSignOut: true }]);
});

function teachMocks(resets, audits) {
  return {
    "next/cache": { refresh: () => {} },
    "next/navigation": { redirect: () => {} },
    "@/lib/server/env": (loadReal) => ({
      ...loadReal("@/lib/server/env"),
      studentEmailDomain: () => "students.example.com",
    }),
    "@/lib/server/audit": {
      audit: async (entry) => {
        audits.push(entry);
      },
    },
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
        return true;
      },
    }),
  };
}

/** Ключ, который вход использует для логина. */
async function loginAccountKey(login) {
  const { actions, calls } = loadLogin({ allow: { "login-ip": true, "login-account": false } });
  await captureWarn(() => actions.login(null, form({ login, password: "x" })));
  return calls.take.find(([purpose]) => purpose === "login-account")[1];
}

test("сброс пароля учителем снимает счётчик логина тем же ключом, что у входа", async () => {
  const resets = [];
  const actions = importTsWith("@/app/(platform)/teach/actions", teachMocks(resets, []));
  const result = await actions.resetStudentPassword(null, form({ studentId: "8f0d2a5e-3c1b-4f6a-9d7e-2b4c6a8e0f13" }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(resets, [["login-account", await loginAccountKey("MD1-Lisa ")]]);
});

test("«Снять блокировку входа»: тот же ключ логина, запись student.login_unlock, IP не трогаем", async () => {
  const resets = [];
  const audits = [];
  const actions = importTsWith("@/app/(platform)/teach/login-unlock", teachMocks(resets, audits));
  const result = await actions.unlockStudentLogin(null, form({ studentId: "8f0d2a5e-3c1b-4f6a-9d7e-2b4c6a8e0f13" }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(resets, [["login-account", await loginAccountKey("md1-lisa")]]);
  assert.deepEqual(audits, [{ actorId: "t1", action: "student.login_unlock", targetUser: "s1", targetGroup: "g1" }]);
});

test("«Снять блокировку входа»: неверный id — invalid_input, счётчики не тронуты", async () => {
  const resets = [];
  const actions = importTsWith("@/app/(platform)/teach/login-unlock", teachMocks(resets, []));
  const result = await actions.unlockStudentLogin(null, form({ studentId: "not-a-uuid" }));
  assert.deepEqual(result, { ok: false, error: "invalid_input" });
  assert.deepEqual(resets, []);
});

// ---------- № 36: ?next= ----------

test("?next= после входа: только /app и /teach", async () => {
  const { safeNext } = importTsWith("@/app/(platform)/login/next-path", {});
  assert.equal(safeNext("/app/lessons/2"), "/app/lessons/2");
  assert.equal(safeNext("/teach"), "/teach");
  for (const bad of ["//evil.example", "/admin", "https://evil.example", "/\\evil", "/applesauce", null]) {
    assert.equal(safeNext(bad), null, String(bad));
  }
});

// ---------- № 32 и № 11: cookie сессии ----------

function sessionCookieModule(nodeEnv) {
  return importTsWith("@/lib/server/supabase/session-cookies", {
    "@/lib/server/env": { isDevelopment: () => nodeEnv === "development" },
  });
}

test("cookie сессии: httpOnly, Secure (кроме next dev), SameSite=Lax, без name и domain", async () => {
  const prod = sessionCookieModule("production").sessionCookieOptions();
  assert.deepEqual(prod, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  assert.equal(sessionCookieModule("development").sessionCookieOptions().secure, false);
});

test("временный сбой Supabase Auth: 429, 5xx и обрыв сети — да; неверный токен — нет", async () => {
  const { isTransientAuthError } = sessionCookieModule("production");
  assert.equal(isTransientAuthError({ status: 429 }), true);
  assert.equal(isTransientAuthError({ status: 503 }), true);
  assert.equal(isTransientAuthError({ name: "AuthRetryableFetchError", status: 0 }), true);
  assert.equal(isTransientAuthError({ status: 400, code: "refresh_token_not_found" }), false);
  assert.equal(isTransientAuthError(null), false);
});

function loadServerClient() {
  const written = [];
  let captured = null;
  const mod = importTsWith("@/lib/server/supabase/server", {
    "next/headers": {
      cookies: async () => ({
        getAll: () => [{ name: "sb-p-auth-token", value: "v" }],
        set: (name, value, options) => written.push({ name, value, options }),
      }),
    },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => {
        captured = options;
        return {};
      },
    },
    "@/lib/server/env": { supabasePublicConfig: () => ({ url: "https://db.example.test", publishableKey: "pk" }) },
    "./session-cookies": { sessionCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }) },
  });
  return { mod, written, options: () => captured };
}

test("клиент Supabase на сервере: флаги cookie; удаление сессии — только при входе и выходе", async () => {
  const { mod, written, options } = loadServerClient();
  const removal = [{ name: "sb-p-auth-token", value: "", options: { maxAge: 0 } }];

  await mod.createClient();
  assert.equal(options().cookieOptions.httpOnly, true);
  options().cookies.setAll(removal);
  assert.equal(written.length, 0, "сбой обновления токена в Route Handler не стирает cookie");
  options().cookies.setAll([{ name: "sb-p-auth-token", value: "new", options: {} }]);
  assert.equal(written.length, 1, "новый токен пишется как раньше");

  await mod.createClient({ allowSignOut: true });
  options().cookies.setAll(removal);
  assert.equal(written.length, 2, "выход удаляет cookie");
});

function loadProxy({ claims = null, error = null, cookiesToSet = [] } = {}) {
  return importTsWith("@/proxy", {
    "@/lib/server/env": {
      isSupabaseConfigured: () => true,
      supabasePublicConfig: () => ({ url: "https://db.example.test", publishableKey: "pk" }),
    },
    "@/lib/server/supabase/session-cookies": (loadReal) => ({
      ...loadReal("@/lib/server/supabase/session-cookies"),
      sessionCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
    }),
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: {
          getClaims: async () => {
            if (cookiesToSet.length) options.cookies.setAll(cookiesToSet, { "cache-control": "private, no-store" });
            return { data: claims ? { claims } : null, error };
          },
        },
      }),
    },
  });
}

async function proxyRequest(proxyModule, path) {
  const { NextRequest } = await import("next/server.js");
  const request = new NextRequest(`https://site.example.test${path}`, { headers: { cookie: "sb-p-auth-token=old" } });
  return proxyModule.proxy(request);
}

const REMOVE = [{ name: "sb-p-auth-token", value: "", options: { maxAge: 0, path: "/" } }];

test("proxy: 429 на обновлении сессии — cookie не удаляются, на /login не ведёт", async () => {
  const proxy = loadProxy({ error: { status: 429, code: "over_request_rate_limit" }, cookiesToSet: REMOVE });
  let response;
  const warns = await captureWarn(async () => {
    response = await proxyRequest(proxy, "/app/lessons/1");
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(warns[0][1], { status: 429 });
});

test("proxy: 503 на обновлении сессии для опроса /api — cookie на месте", async () => {
  const proxy = loadProxy({ error: { name: "AuthRetryableFetchError", status: 503 }, cookiesToSet: REMOVE });
  let res;
  await captureWarn(async () => {
    res = await proxyRequest(proxy, "/api/jobs/1");
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("proxy: сессия умерла (refresh_token_not_found) — cookie удаляются и редирект на /login", async () => {
  const proxy = loadProxy({ error: { status: 400, code: "refresh_token_not_found" }, cookiesToSet: REMOVE });
  const response = await proxyRequest(proxy, "/app");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location"), /\/login\?next=%2Fapp$/);
  assert.match(response.headers.get("set-cookie") ?? "", /sb-p-auth-token=;.*Max-Age=0/);
});

test("proxy: обновлённый токен уходит в ответ с флагами и без кеша", async () => {
  const proxy = loadProxy({
    claims: { sub: "u1" },
    cookiesToSet: [{ name: "sb-p-auth-token", value: "new", options: { httpOnly: true, secure: true, path: "/" } }],
  });
  const response = await proxyRequest(proxy, "/app");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /sb-p-auth-token=new;.*HttpOnly/i);
  assert.match(response.headers.get("set-cookie"), /Secure/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("proxy: /admin пока ведёт в кабинет ведущего", async () => {
  const response = await proxyRequest(loadProxy(), "/admin/anything?x=1");
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/teach");
});

// ---------- № 13: опрос задачи на 401 ----------

test("опрос задачи: ссылка «Войти заново» возвращает на ту же страницу", async () => {
  const { loginAgainHref } = importTsWith("@/components/platform/GenerateClient", {
    "@/lib/platform/job-poll": {},
    "@/lib/platform/generation-types": {},
    react: {},
  });
  assert.equal(loginAgainHref("/app/lessons/3"), "/login?next=%2Fapp%2Flessons%2F3");
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
