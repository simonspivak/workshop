import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Обратный вызов «задача закончилась» (POST /api/jobs/callback, lib/server/job-callback.ts) на подменах:
  подпись адреса, ответы маршрута, внеочередная проверка через настоящий advanceJob и замки
  claim_job_poll / begin_job_storing (их SQL изображают подмены ниже). База, шлюз и kie не трогаются.
*/

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const APP = "https://app.example.test";
const SECRET = "test-secret-key-for-callback-0123456789";

function envMock({ app = APP, mode = "live" } = {}) {
  return {
    ConfigError: class ConfigError extends Error {},
    appUrl: () => app,
    gatewayConfig: () => (mode === "mock" ? { mode: "mock" } : { mode: "live", url: "https://gateway.invalid/hook", key: "k" }),
    supabaseSecretConfig: () => ({ url: "https://db.invalid", secretKey: SECRET }),
  };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/**
 * Мир задачи: одна строка jobs и подмены, ведущие себя как SQL-функции.
 * claim_job_poll и begin_job_storing проверяют и меняют строку без await между проверкой и записью —
 * как атомарный UPDATE … WHERE в базе.
 */
function world({ job = {}, status, env } = {}) {
  const row = {
    id: JOB_ID,
    user_id: "u1",
    group_id: null,
    action: "video",
    model: "bytedance/seedance-2-mini",
    status: "submitted",
    stars: 25,
    prompt: "кот",
    result_text: null,
    storage_path: null,
    extra_paths: [],
    mime_type: null,
    error: null,
    hidden: false,
    deleted_at: null,
    gateway_task_id: "task-1",
    lesson_id: null,
    task_ref: null,
    created_at: iso(5 * 60_000),
    updated_at: iso(60_000),
    submitted_at: iso(5 * 60_000),
    completed_at: null,
    last_polled_at: iso(5 * 60_000),
    callback: true,
    ...job,
  };
  const calls = { select: [], status: 0, claims: [], begin: 0, after: [], refund: [], from: 0 };
  const statusReply = status ?? { ok: true, taskId: "task-1", state: "success", done: true, urls: ["https://x.aiquickdraw.com/v.mp4"], credits: 19 };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const mocks = {
    "next/server": { after: (fn) => calls.after.push(fn) },
    "@/lib/server/env": env ?? envMock(),
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/dal/teacher": { isUuid: (v) => /^[0-9a-f-]{36}$/.test(v) },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => {
        calls.from++;
        const builder = {
          select: (cols) => (calls.select.push(cols), builder),
          eq: () => builder,
          maybeSingle: async () => ({ data: { ...row }, error: null }),
        };
        return { from: () => builder };
      },
    },
    "@/lib/server/gateway": {
      getTaskStatus: async () => {
        calls.status++;
        await tick();
        return statusReply;
      },
      downloadResult: async () => ({ ok: false, error: "download_failed" }),
    },
    "@/lib/server/jobs": {
      claimJobPoll: async (_id, interval) => {
        calls.claims.push(interval);
        await tick();
        if (row.status !== "submitted") return false;
        const last = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
        if (Date.now() - last < Math.max(interval, 1) * 1000) return false;
        row.last_polled_at = new Date().toISOString();
        return true;
      },
      beginJobStoring: async () => {
        await tick();
        if (row.status !== "submitted") return false;
        row.status = "storing";
        calls.begin++;
        return true;
      },
      completeJob: async () => true,
      mediaPath: (u, j, ext) => `${u}/${j}.${ext}`,
    },
    "@/lib/server/storage": { signMediaPaths: async () => new Map(), uploadMedia: async () => ({ ok: true }) },
    "@/lib/server/wallet": {
      refundJob: async (...args) => {
        calls.refund.push(args);
        row.status = "failed";
        return { ok: true };
      },
    },
  };
  return {
    row,
    calls,
    mocks,
    progress: () => importTsWith("@/lib/server/job-progress", mocks),
    callback: () => importTsWith("@/lib/server/job-callback", mocks),
    route: () => importTsWith("@/app/api/jobs/callback/route", mocks),
  };
}

const req = (query) => ({ nextUrl: new URL(`${APP}/api/jobs/callback${query}`) });

async function runAfters(calls) {
  // after() внутри after(): выполняем, пока появляются новые
  for (let i = 0; i < calls.after.length; i++) await calls.after[i]();
}

async function quiet(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ---------- подпись ----------

test("callback: подпись верна только для своей задачи; без job или sig — отказ", () => {
  const w = world();
  const { jobCallbackSignature, verifyJobCallback } = w.callback();
  const sig = jobCallbackSignature(JOB_ID);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: JOB_ID, sig })), JOB_ID);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: JOB_ID.toUpperCase(), sig: sig.toUpperCase() })), JOB_ID);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: OTHER_ID, sig })), null);
  const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assert.equal(verifyJobCallback(new URLSearchParams({ job: JOB_ID, sig: flipped })), null);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: JOB_ID })), null);
  assert.equal(verifyJobCallback(new URLSearchParams({ sig })), null);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: JOB_ID, sig: sig.slice(0, 32) })), null);
  assert.equal(verifyJobCallback(new URLSearchParams({ job: "not-a-uuid", sig })), null);
});

test("callback: другой секретный ключ — другая подпись", () => {
  const a = world().callback().jobCallbackSignature(JOB_ID);
  const env = { ...envMock(), supabaseSecretConfig: () => ({ url: "https://db.invalid", secretKey: `${SECRET}-other` }) };
  const b = world({ env }).callback().jobCallbackSignature(JOB_ID);
  assert.notEqual(a, b);
});

// ---------- адрес ----------

test("callback: адрес только для асинхронных действий и только с публичным https APP_URL", () => {
  const { jobCallbackUrl, callbackPlanned, verifyJobCallback } = world().callback();
  for (const action of ["image", "image_edit", "video", "motion", "lipsync", "voice", "music"]) {
    const url = jobCallbackUrl(JOB_ID, action);
    assert.ok(url, action);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, `${APP}/api/jobs/callback`);
    assert.deepEqual([...parsed.searchParams.keys()], ["job", "sig"]);
    assert.equal(verifyJobCallback(parsed.searchParams), JOB_ID);
    assert.equal(callbackPlanned(action), true);
  }
  for (const action of ["text", "montage"]) {
    assert.equal(jobCallbackUrl(JOB_ID, action), null);
    assert.equal(callbackPlanned(action), false);
  }
  assert.equal(jobCallbackUrl("bad-id", "video"), null);

  for (const env of [envMock({ app: null }), envMock({ app: "http://localhost:3000" }), envMock({ app: "https://localhost" }), envMock({ mode: "mock" })]) {
    const mod = world({ env }).callback();
    assert.equal(mod.jobCallbackUrl(JOB_ID, "video"), null);
    assert.equal(mod.callbackPlanned("video"), false);
  }
});

test("callback: шлюз получает callbackUrl полем запроса, только если он передан", async () => {
  const gateway = importTsWith("@/lib/server/gateway", {
    "@/lib/server/env": { gatewayConfig: () => ({ mode: "live", url: "http://gateway.invalid/hook", key: "test-key" }) },
    "@/lib/server/mock-media": { mockMedia: () => ({}) },
  });
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, taskId: "t1", state: "queued" }), { status: 200 });
  };
  try {
    const url = `${APP}/api/jobs/callback?job=${JOB_ID}&sig=${"a".repeat(64)}`;
    await gateway.createTask({ action: "video", prompt: "кот" }, { jobId: JOB_ID, callbackUrl: url });
    await gateway.createTask({ action: "video", prompt: "кот" }, { jobId: JOB_ID });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(bodies[0].callbackUrl, `${APP}/api/jobs/callback?job=${JOB_ID}&sig=${"a".repeat(64)}`);
  assert.equal(bodies[0].jobId, JOB_ID);
  assert.equal("callbackUrl" in bodies[1], false);
});

// ---------- маршрут ----------

test("callback: неверная или пустая подпись — 404 без подробностей, база и шлюз не трогаются", async () => {
  const w = world();
  const route = w.route();
  for (const query of ["", `?job=${JOB_ID}`, `?job=${JOB_ID}&sig=${"0".repeat(64)}`, `?job=x&sig=y`]) {
    for (const method of ["POST", "GET"]) {
      const res = await route[method](req(query));
      assert.equal(res.status, 404, `${method} ${query}`);
      assert.deepEqual(await res.json(), { error: "not_found" });
    }
  }
  assert.equal(w.calls.after.length, 0);
  assert.equal(w.calls.from, 0);
  assert.equal(w.calls.status, 0);
});

test("callback: GET с верной подписью — 200 без работы", async () => {
  const w = world();
  const sig = w.callback().jobCallbackSignature(JOB_ID);
  const res = await w.route().GET(req(`?job=${JOB_ID}&sig=${sig}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(w.calls.after.length, 0);
  assert.equal(w.calls.from, 0);
});

test("callback: готовая задача — 200, повторы ничего не делают", async () => {
  for (const status of ["done", "failed", "storing", "queued"]) {
    const w = world({ job: { status } });
    const sig = w.callback().jobCallbackSignature(JOB_ID);
    const route = w.route();
    for (let i = 0; i < 3; i++) {
      const res = await route.POST(req(`?job=${JOB_ID}&sig=${sig}`));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    }
    await runAfters(w.calls);
    assert.deepEqual(w.calls.claims, [], status);
    assert.equal(w.calls.status, 0, status);
    assert.deepEqual(w.calls.refund, []);
    assert.equal(w.row.status, status);
  }
});

test("callback: submitted — ровно одна проверка у шлюза, ответ без данных задачи, копирование в after()", async () => {
  // задача только что отправлена: по расписанию (с обратным вызовом — 60 с) шлюз ещё рано спрашивать
  const w = world({ job: { submitted_at: iso(40_000), created_at: iso(41_000), last_polled_at: iso(40_000) } });
  const sig = w.callback().jobCallbackSignature(JOB_ID);
  const res = await w.route().POST(req(`?job=${JOB_ID}&sig=${sig}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(w.calls.status, 0, "до ответа шлюз не спрашиваем");
  assert.equal(w.calls.after.length, 1);
  await quiet(() => runAfters(w.calls));
  assert.equal(w.calls.status, 1);
  assert.equal(w.calls.begin, 1);
  assert.equal(w.calls.after.length, 2, "копирование — во вложенном after()");
  assert.ok(w.calls.select[0].includes("callback:params->callback"));
});

test("callback: шлюз говорит «ещё генерирует» — задача ждёт, звёзды не трогаются", async () => {
  const w = world({ status: { ok: true, taskId: "task-1", state: "generating", done: false, urls: [], credits: null } });
  const sig = w.callback().jobCallbackSignature(JOB_ID);
  const res = await w.route().POST(req(`?job=${JOB_ID}&sig=${sig}`));
  assert.equal(res.status, 200);
  await runAfters(w.calls);
  assert.equal(w.calls.status, 1);
  assert.equal(w.row.status, "submitted");
  assert.deepEqual(w.calls.refund, []);
});

test("callback: обходит расписание опроса, но не замок claim_job_poll", async () => {
  const w = world({ job: { submitted_at: iso(40_000), last_polled_at: iso(40_000) } });
  const { advanceJob, CALLBACK_MIN_INTERVAL_SEC } = w.progress();
  // опрос из браузера: задача с обратным вызовом, 40 с — рано (первая проверка через 60 с)
  await advanceJob({ ...w.row });
  assert.deepEqual(w.calls.claims, []);
  assert.equal(w.calls.status, 0);
  // без обратного вызова та же задача уже проверялась бы (первая проверка видео — через 30 с)
  const plain = world({ job: { submitted_at: iso(40_000), last_polled_at: iso(40_000), callback: null } });
  await plain.progress().advanceJob({ ...plain.row });
  assert.equal(plain.calls.status, 1);
  // сигнал kie: проверка сейчас, с минимальной паузой замка
  await advanceJob({ ...w.row }, { trigger: "callback" });
  assert.deepEqual(w.calls.claims, [CALLBACK_MIN_INTERVAL_SEC]);
  assert.equal(w.calls.status, 1);
});

test("callback: одновременно с опросом из браузера — одна проверка и одно копирование", async () => {
  const w = world();
  const { advanceJob } = w.progress();
  const results = await Promise.all([
    advanceJob({ ...w.row }, { trigger: "callback" }),
    advanceJob({ ...w.row }),
    advanceJob({ ...w.row }, { trigger: "callback" }),
  ]);
  assert.equal(w.calls.claims.length, 3);
  assert.equal(w.calls.status, 1);
  assert.equal(w.calls.begin, 1);
  assert.equal(w.calls.after.length, 1);
  assert.equal(results.filter((job) => job.status === "storing").length, 1);
});

test("callback: два вызова kie подряд — второй не спрашивает шлюз (замок 2 с)", async () => {
  const w = world({ status: { ok: true, taskId: "task-1", state: "generating", done: false, urls: [], credits: null } });
  const sig = w.callback().jobCallbackSignature(JOB_ID);
  const route = w.route();
  await route.POST(req(`?job=${JOB_ID}&sig=${sig}`));
  await route.POST(req(`?job=${JOB_ID}&sig=${sig}`));
  await runAfters(w.calls);
  assert.equal(w.calls.claims.length, 2);
  assert.equal(w.calls.status, 1);
});

test("callback: сбой внутри after() не роняет маршрут (ответ уже 200)", async () => {
  const w = world();
  w.mocks["@/lib/server/supabase/admin"] = {
    createAdminClient: () => {
      throw new Error("db down");
    },
  };
  const sig = w.callback().jobCallbackSignature(JOB_ID);
  const res = await w.route().POST(req(`?job=${JOB_ID}&sig=${sig}`));
  assert.equal(res.status, 200);
  await quiet(() => runAfters(w.calls));
  assert.equal(w.calls.status, 0);
});

// ---------- создание задачи: /api/generate ----------

function loadGenerate({ env, action = "image" }) {
  const seen = { create: [], debit: [] };
  const mod = importTsWith("@/lib/server/generate", {
    "next/server": { after: () => {} },
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/course": { getLessonById: () => null, lessonHasTask: () => false },
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/env": env,
    "@/lib/server/gateway": {
      createTask: async (request, options) => {
        seen.create.push({ request, options });
        return { ok: true, taskId: "t1", state: "queued" };
      },
      generateText: async () => ({ ok: true, text: "ответ", credits: 1 }),
      isAccountFailure: () => false,
      isGatewayModel: () => true,
      isPermanentFailure: () => false,
    },
    "@/lib/server/job-progress": {
      loadJob: async (id) => ({ id, status: "done", action }),
      toJobView: async (job) => ({ id: job.id, status: job.status }),
      advanceJob: async (job) => job,
    },
    "@/lib/server/jobs": { completeJob: async () => true, markJobSubmitted: async () => true },
    "@/lib/server/moderation": { moderateFields: () => ({ ok: true }) },
    "@/lib/server/prices": {
      canUse: async () => ({ ok: true, model: action === "text" ? "claude-haiku-5-5" : "nano-banana-2-1", stars: 5 }),
      LONG_TEXT_TOKENS: 800,
    },
    "@/lib/server/storage": {
      resolveReferences: async () => ({ ok: true, refs: { urls: {}, stored: {} } }),
      checkLipsyncAudio: async () => ({ ok: true, seconds: null }),
    },
    "@/lib/server/wallet": {
      createJobWithDebit: async (input) => {
        seen.debit.push(input);
        return { ok: true, jobId: JOB_ID, balance: 99, reused: false };
      },
      refundJob: async () => ({ ok: true }),
    },
  });
  const input = mod.generateRequestSchema.parse({ action, prompt: "кот на скейте", idempotencyKey: "key-callback-0001" });
  const user = { id: "u1", role: "student", group: { id: "g1", shareGallery: false }, ageBand: "adult", parentalConsent: true };
  return { run: () => mod.startGeneration(user, input), seen };
}

test("callback: /api/generate — картинка уходит в шлюз с callbackUrl и помечается params.callback", async () => {
  const { run, seen } = loadGenerate({ env: envMock() });
  const outcome = await run();
  assert.equal(outcome.kind, "accepted");
  assert.equal(seen.create.length, 1);
  const { callbackUrl, jobId } = seen.create[0].options;
  assert.equal(jobId, JOB_ID);
  assert.ok(callbackUrl.startsWith(`${APP}/api/jobs/callback?job=${JOB_ID}&sig=`));
  assert.equal(seen.debit[0].params.callback, true);
});

test("callback: /api/generate — без публичного APP_URL и в mock-режиме нет ни callbackUrl, ни пометки", async () => {
  for (const env of [envMock({ app: null }), envMock({ app: "http://localhost:3000" }), envMock({ mode: "mock" })]) {
    const { run, seen } = loadGenerate({ env });
    await run();
    assert.equal(seen.create[0].options.callbackUrl, undefined);
    assert.equal("callback" in seen.debit[0].params, false);
  }
});

test("callback: /api/generate — текст без обратного вызова", async () => {
  const { run, seen } = loadGenerate({ env: envMock(), action: "text" });
  await run();
  assert.equal(seen.create.length, 0);
  assert.equal("callback" in seen.debit[0].params, false);
});
