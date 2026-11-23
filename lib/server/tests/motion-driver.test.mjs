import assert from "node:assert/strict";
import { importTs, importTsWith, test } from "../bot/tests/harness.mjs";
import { faststart, fileServer, moovAtEnd } from "../../platform/tests/mp4-fixtures.mjs";

/*
  Длина образца для переноса движения (lib/server/motion-driver.ts) и проверка до списания
  в POST /api/generate (lib/server/generate.ts). Storage и шлюз не трогаются: fetch подменён
  «сервером» с MP4, собранным в тесте (lib/platform/tests/mp4-fixtures.mjs).
  Ещё здесь — результат больше лимита бакета: too_large по Content-Length, возврат сразу.
*/

const MIN = 60_000;
const SIGNED = "https://storage.invalid/object/sign/media/library/motion/dance.mp4?token=t";
const LIB = "library/motion/dance.mp4";

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
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

/** Свежий модуль (свой кеш длин) на каждый тест. */
const freshDriver = () => importTsWith("@/lib/server/motion-driver", {});

// ---------- чтение по ссылке ----------

test("образец: faststart — один Range-запрос на 64 КБ, файл целиком не качается", async () => {
  const server = fileServer(faststart(10, { mdatBytes: 2 * 1024 * 1024 }));
  const { measureMp4Seconds } = freshDriver();
  const seconds = await withFetch(server.fetch, () => measureMp4Seconds(SIGNED));
  assert.equal(seconds, 10);
  assert.deepEqual(server.stats.requests, [[0, 65_535]]);
  assert.ok(server.stats.bytesServed <= 64 * 1024 + 16 * 1024, `отдано ${server.stats.bytesServed}`);
});

test("образец: moov в конце — два Range-запроса (начало и moov), ≈ 64 КБ + moov", async () => {
  const file = moovAtEnd(30, { mdatBytes: 3 * 1024 * 1024 });
  const server = fileServer(file);
  const { measureMp4Seconds } = freshDriver();
  const seconds = await withFetch(server.fetch, () => measureMp4Seconds(SIGNED));
  assert.equal(seconds, 30);
  assert.equal(server.stats.requests.length, 2);
  assert.equal(server.stats.requests[1][0], file.length - 216);
  assert.ok(server.stats.bytesServed < 64 * 1024 + 1024, `отдано ${server.stats.bytesServed} из ${file.length}`);
});

test("образец: сервер не понял Range (200) — читаем только начало и обрываем поток", async () => {
  const file = faststart(8, { mdatBytes: 5 * 1024 * 1024 });
  const server = fileServer(file, { ignoreRange: true });
  const { measureMp4Seconds } = freshDriver();
  const seconds = await withFetch(server.fetch, () => measureMp4Seconds(SIGNED));
  assert.equal(seconds, 8);
  assert.ok(server.stats.bytesServed <= 64 * 1024 + 32 * 1024, `отдано ${server.stats.bytesServed} из ${file.length}`);
});

test("образец: 200 вместо 206 при чтении с середины — не годится, длина неизвестна", async () => {
  const server = fileServer(moovAtEnd(10, { mdatBytes: 1024 * 1024 }), { ignoreRange: true });
  const { measureMp4Seconds } = freshDriver();
  const seconds = await quiet(() => withFetch(server.fetch, () => measureMp4Seconds(SIGNED)));
  assert.equal(seconds, null);
  assert.ok(server.stats.bytesServed < 200 * 1024);
});

test("образец: 404, сеть, не MP4 — null (неизвестно), не ноль", async () => {
  const { measureMp4Seconds } = freshDriver();
  await quiet(async () => {
    assert.equal(await withFetch(fileServer(faststart(5), { status: 404 }).fetch, () => measureMp4Seconds(SIGNED)), null);
    assert.equal(await withFetch(async () => Promise.reject(new TypeError("fetch failed")), () => measureMp4Seconds(SIGNED)), null);
    assert.equal(await withFetch(fileServer(new Uint8Array(5000).fill(7)).fetch, () => measureMp4Seconds(SIGNED)), null);
  });
});

// ---------- правило 10 с ----------

test("образец: 10,0 и 10,4 с проходят, 10,6 и 30 с — нет (ученик и ведущий)", async () => {
  for (const [seconds, ok] of [[10, true], [10.4, true], [10.6, false], [30, false]]) {
    for (const staff of [false, true]) {
      const { checkMotionDriver } = freshDriver();
      const server = fileServer(moovAtEnd(seconds));
      const result = await withFetch(server.fetch, () => checkMotionDriver({ staff, path: LIB, url: SIGNED }));
      assert.equal(result.ok, ok, `${seconds} с, staff=${staff}`);
      if (!ok) assert.equal(result.error, "motion_too_long");
      assert.ok(Math.abs(result.seconds - seconds) < 1e-9);
    }
  }
});

test("образец: длина неизвестна — пропускаем и ученика, и ведущего (сбой измерения не выключает перенос движения)", async () => {
  const broken = fileServer(new Uint8Array(3000));
  await quiet(async () => {
    const student = await withFetch(broken.fetch, () => freshDriver().checkMotionDriver({ staff: false, path: LIB, url: SIGNED }));
    assert.deepEqual(student, { ok: true, seconds: null });
    const staff = await withFetch(broken.fetch, () => freshDriver().checkMotionDriver({ staff: true, path: LIB, url: SIGNED }));
    assert.deepEqual(staff, { ok: true, seconds: null });
  });
});

test("образец: https-ссылку ведущего сервер не открывает — длина неизвестна, ведущему можно", async () => {
  const { checkMotionDriver } = freshDriver();
  const url = "https://cdn.example.invalid/clip.mp4";
  const result = await withFetch(
    () => assert.fail("внешнюю ссылку не качаем"),
    () => checkMotionDriver({ staff: true, path: url, url }),
  );
  assert.deepEqual(result, { ok: true, seconds: null });
});

test("образец: повторный клик — длина из кеша, Storage не спрашиваем", async () => {
  const { checkMotionDriver } = freshDriver();
  const server = fileServer(faststart(10));
  await withFetch(server.fetch, async () => {
    await checkMotionDriver({ staff: false, path: LIB, url: SIGNED });
    await checkMotionDriver({ staff: false, path: LIB, url: SIGNED + "2" });
    await checkMotionDriver({ staff: false, path: LIB, url: SIGNED });
  });
  assert.equal(server.stats.requests.length, 1);
});

// ---------- кеш длин ----------

function cacheWith(values) {
  const { createDriverDurationCache, DRIVER_CACHE_TTL_MS, DRIVER_UNKNOWN_TTL_MS, DRIVER_VERSIONED_TTL_MS } = importTs("@/lib/server/motion-driver");
  let now = 1_000_000;
  const measured = [];
  let i = 0;
  const cache = createDriverDurationCache({
    now: () => now,
    measure: async (url) => (measured.push(url), values[Math.min(i++, values.length - 1)]),
    maxEntries: 3,
  });
  return { cache, measured, tick: (ms) => (now += ms), DRIVER_CACHE_TTL_MS, DRIVER_UNKNOWN_TTL_MS, DRIVER_VERSIONED_TTL_MS };
}

test("кеш длин: без версии — 5 минут, потом меряем заново", async () => {
  const { cache, measured, tick, DRIVER_CACHE_TTL_MS } = cacheWith([10, 30]);
  assert.equal(DRIVER_CACHE_TTL_MS, 5 * MIN);
  assert.equal(await cache.get(LIB, "u1"), 10);
  tick(4 * MIN);
  assert.equal(await cache.get(LIB, "u2"), 10);
  assert.equal(measured.length, 1);
  tick(MIN + 1);
  assert.equal(await cache.get(LIB, "u3"), 30, "файл заменили — через 5 минут видна новая длина");
  assert.equal(measured.length, 2);
});

test("кеш длин: с версией (updated_at|size) — до часа; файл перезалили — меряем сразу", async () => {
  const { cache, measured, tick } = cacheWith([10, 30]);
  assert.equal(await cache.get(LIB, "u", "2026-11-16T10:00:00Z|100"), 10);
  tick(50 * MIN);
  assert.equal(await cache.get(LIB, "u", "2026-11-16T10:00:00Z|100"), 10);
  assert.equal(measured.length, 1);
  assert.equal(await cache.get(LIB, "u", "2026-11-16T12:00:00Z|300"), 30);
  assert.equal(measured.length, 2);
  // свежий замер с версией годится и проверке без версии (5 минут)
  assert.equal(await cache.get(LIB, "u"), 30);
  assert.equal(measured.length, 2);
});

test("кеш длин: «неизвестно» держится минуту; одновременные запросы — один замер", async () => {
  const { cache, measured, tick } = cacheWith([null, 9]);
  const [a, b] = await Promise.all([cache.get(LIB, "u"), cache.get(LIB, "u")]);
  assert.equal(a, null);
  assert.equal(b, null);
  assert.equal(measured.length, 1);
  tick(30_000);
  assert.equal(await cache.get(LIB, "u"), null);
  tick(31_000);
  assert.equal(await cache.get(LIB, "u"), 9);
  assert.equal(measured.length, 2);
});

test("кеш длин: не больше maxEntries; замер бросил — null, а не исключение", async () => {
  const { createDriverDurationCache } = importTs("@/lib/server/motion-driver");
  const cache = createDriverDurationCache({ measure: async () => 5, maxEntries: 2 });
  await cache.get("a", "u");
  await cache.get("b", "u");
  await cache.get("c", "u");
  assert.equal(cache.size(), 2);
  const throwing = createDriverDurationCache({ measure: async () => Promise.reject(new Error("boom")) });
  assert.equal(await throwing.get("a", "u"), null);
});

// ---------- POST /api/generate: motion ----------

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT = { id: "u1", role: "student", group: { id: "g1", shareGallery: false }, ageBand: "adult", parentalConsent: false };
const TEACHER = { id: "t1", role: "teacher", group: null, ageBand: "adult", parentalConsent: false };

function loadGenerate() {
  const calls = { debit: [], createTask: [] };
  const mod = importTsWith("@/lib/server/generate", {
    "next/server": { after: () => {} },
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/course": { getLessonById: () => null, lessonHasTask: () => false },
    "@/lib/server/dal/auth": { isStaff: (user) => user.role !== "student" },
    "@/lib/server/env": { appUrl: () => null },
    "@/lib/server/gateway": {
      createTask: async (...args) => (calls.createTask.push(args), { ok: true, taskId: "task-1", state: "queued" }),
      generateText: async () => assert.fail("текст не ждали"),
      isAccountFailure: () => false,
      isGatewayModel: () => true,
      isPermanentFailure: () => false,
    },
    "@/lib/server/job-callback": { callbackPlanned: () => false, jobCallbackUrl: () => null },
    "@/lib/server/job-progress": { loadJob: async () => null, toJobView: async () => ({}) },
    "@/lib/server/jobs": { completeJob: async () => true, markJobSubmitted: async () => true },
    "@/lib/server/moderation": { moderateFields: () => ({ ok: true }) },
    "@/lib/server/prices": {
      canUse: async (user) => ({ ok: true, model: "kling-2.6/motion-control", stars: user.role === "student" ? 70 : 0, libraryOnly: true }),
      LONG_TEXT_TOKENS: 800,
    },
    "@/lib/server/storage": {
      resolveReferences: async (_user, input) => ({
        ok: true,
        refs: {
          urls: { images: ["https://storage.invalid/hero.jpg"], video: SIGNED },
          stored: { images: input.images, video: input.video },
        },
      }),
      checkLipsyncAudio: async () => ({ ok: true, seconds: null }),
    },
    "@/lib/server/wallet": {
      createJobWithDebit: async (args) => (calls.debit.push(args), { ok: true, jobId: JOB_ID, balance: 30, reused: false }),
      refundJob: async () => ({ ok: true, refunded: 0, balance: 0 }),
    },
  });
  const input = mod.generateRequestSchema.parse({
    action: "motion",
    images: ["u1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg"],
    video: LIB,
    idempotencyKey: "key-motion-0001",
  });
  return { run: (user) => mod.startGeneration(user, input), calls };
}

test("generate motion: образец 30 с — отказ до списания и без шлюза", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await withFetch(fileServer(moovAtEnd(30)).fetch, () => run(STUDENT));
  assert.deepEqual(outcome, { kind: "error", status: 422, error: "motion_too_long", field: "video" });
  assert.deepEqual(calls.debit, []);
  assert.deepEqual(calls.createTask, []);
});

test("generate motion: длина неизвестна — задача уходит и у ученика, и у ведущего", async () => {
  const broken = fileServer(new Uint8Array(2048));
  const student = loadGenerate();
  const passed = await quiet(() => withFetch(broken.fetch, () => student.run(STUDENT)));
  assert.equal(passed.kind, "accepted");
  assert.equal(student.calls.debit.length, 1);
  assert.equal(student.calls.createTask.length, 1);
  const teacher = loadGenerate();
  const accepted = await quiet(() => withFetch(broken.fetch, () => teacher.run(TEACHER)));
  assert.equal(accepted.kind, "accepted");
  assert.equal(teacher.calls.debit.length, 1);
  assert.equal(teacher.calls.createTask.length, 1);
});

test("generate motion: образец 10 с — списание и задача; длина записана в params", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await withFetch(fileServer(faststart(10)).fetch, () => run(STUDENT));
  assert.equal(outcome.kind, "accepted");
  assert.equal(calls.debit.length, 1);
  assert.equal(calls.debit[0].stars, 70);
  assert.equal(calls.debit[0].params.driverSeconds, 10);
  assert.equal(calls.createTask.length, 1);
  assert.equal(calls.createTask[0][0].video, SIGNED);
});

// ---------- результат больше лимита бакета ----------

test("downloadResult: лимит = лимит бакета (50 МиБ); Content-Length больше — too_large без чтения тела", async () => {
  const gateway = importTsWith("@/lib/server/gateway", {
    "@/lib/server/env": { gatewayConfig: () => ({ mode: "live", url: "http://gateway.invalid/hook", key: "test-key" }) },
    "@/lib/server/mock-media": { mockMedia: () => ({}) },
  });
  assert.equal(gateway.MAX_RESULT_BYTES, 52_428_800);
  let pulled = 0;
  const fake = async () =>
    new Response(new ReadableStream({ pull: (c) => (pulled++, c.enqueue(new Uint8Array(1024))) }), {
      status: 200,
      headers: { "content-length": String(60 * 1024 * 1024) },
    });
  const result = await withFetch(fake, () => gateway.downloadResult("https://tempfile.aiquickdraw.com/r/clip.mp4"));
  assert.deepEqual(result, { ok: false, error: "too_large" });
  assert.ok(pulled <= 1, `прочитано кусков: ${pulled}`);
});

test("uploadMedia: файл больше лимита бакета — too_large без запроса в Storage", async () => {
  const storage = importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => assert.fail("в Storage не ходим"),
      createAdminClientUntil: () => assert.fail("в Storage не ходим"),
    },
  });
  const result = await quiet(() => storage.uploadMedia("u1/a.mp4", { byteLength: 52_428_801 }, "video/mp4"));
  assert.deepEqual(result, { ok: false, error: "too_large" });
});

test("сохранение результата: too_large — возврат сразу с кодом result_too_large", async () => {
  const refunds = [];
  const mod = importTsWith("@/lib/server/job-progress", {
    "next/server": { after: () => {} },
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/dal/teacher": { isUuid: () => true },
    "@/lib/server/supabase/admin": { createAdminClient: () => ({}), createAdminClientUntil: () => ({}) },
    "@/lib/server/gateway": { downloadResult: async () => ({ ok: false, error: "too_large" }), getTaskStatus: async () => ({ ok: false }) },
    "@/lib/server/jobs": { mediaPath: () => "x", claimJobPoll: async () => true, beginJobStoring: async () => true, completeJob: async () => true },
    "@/lib/server/wallet": { refundJob: async (...args) => (refunds.push(args), { ok: true, refunded: 70, balance: 70 }) },
  });
  await mod.storeJobResult({ id: JOB_ID, user_id: "u1" }, ["https://tempfile.aiquickdraw.com/r/clip.mp4"], 378);
  assert.deepEqual(refunds, [[JOB_ID, "result_too_large: too_large"]]);
  const { jobErrorCode } = importTs("@/lib/server/job-rules");
  assert.equal(jobErrorCode("result_too_large: too_large"), "result_too_large");
  const { platformErrorMessage } = importTs("@/lib/platform/generation-messages");
  assert.match(platformErrorMessage("result_too_large"), /слишком больш.*Звёзды вернулись/);
  assert.match(platformErrorMessage("motion_too_long"), /^Образец длиннее 10 секунд\./);
});
