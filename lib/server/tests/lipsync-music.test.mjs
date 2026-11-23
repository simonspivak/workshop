import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  «Говорящая голова»: длина озвучки ученика (lib/server/storage.ts checkLipsyncAudio, потолок
  STUDENT_LIPSYNC_MAX_SEC = 20 с + 0,5 с) и отказ с длиной в ответе POST /api/generate.
  Музыка: длина трека и голос уходят в шлюз только в custom-режиме Suno (lib/server/generate.ts).
  База, Storage и шлюз подменены; WAV отдаёт «сервер» в тесте по Range-запросу.
*/

const USER_ID = "11111111-1111-4111-8111-111111111111";
const VOICE_JOB = "44444444-4444-4444-8444-444444444444";
const LIPSYNC_JOB = "55555555-5555-4555-8555-555555555555";
const VOICE_PATH = `${USER_ID}/${VOICE_JOB}.wav`;
const SIGNED = "https://storage.invalid/object/sign/media/voice.wav?token=t";
const STUDENT = { id: USER_ID, role: "student", group: { id: "g1", shareGallery: false }, ageBand: "adult", parentalConsent: false };
const TEACHER = { id: "t1", role: "teacher", group: null, ageBand: "adult", parentalConsent: false };
const BYTE_RATE = 48_000; // 24 кГц, 16 бит, моно — как у Gemini TTS

/** Заголовок WAV и полный размер файла заданной длины. */
function wav(seconds) {
  const dataBytes = Math.round(seconds * BYTE_RATE / 2) * 2;
  const head = new Uint8Array(44);
  const view = new DataView(head.buffer);
  const put = (at, text) => [...text].forEach((ch, i) => (head[at + i] = ch.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, BYTE_RATE, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, dataBytes, true);
  return { head, total: 44 + dataBytes };
}

/** «Storage»: отдаёт начало WAV по Range (206), считает запросы. seconds null — не WAV (MP3). */
function wavServer(seconds) {
  const stats = { requests: 0 };
  const fetch = async (_url, init = {}) => {
    stats.requests++;
    const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range ?? "");
    assert.ok(range, "длину читаем Range-запросом");
    const file = seconds === null ? { head: new TextEncoder().encode("ID3\u0004 mp3 frames…"), total: 50_000 } : wav(seconds);
    const end = Math.min(Number(range[2]), file.total - 1);
    const body = new Uint8Array(end + 1);
    body.set(file.head.subarray(0, Math.min(file.head.length, body.length)));
    return new Response(body, { status: 206, headers: { "content-range": `bytes 0-${end}/${file.total}` } });
  };
  return { fetch, stats };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Подмена admin-клиента: строка задачи озвучки (action, prompt). */
function adminWith(job) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: job, error: null }),
  };
  return { createAdminClient: () => ({ from: () => query }), createAdminClientUntil: () => ({ from: () => query }) };
}

const VOICE_JOB_ROW = { action: "voice", prompt: "Привет! Это выпуск новостей общины 770." };

/** Свежий storage (свой кеш длин) с подменённой базой. */
function loadStorage(job = VOICE_JOB_ROW) {
  return importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: (user) => user.role !== "student" },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": adminWith(job),
  });
}

const check = (storage, seconds, staff = false) =>
  withFetch(wavServer(seconds).fetch, () => storage.checkLipsyncAudio({ staff, path: VOICE_PATH, url: SIGNED }));

// ---------- проверка длины ----------

test("говорящая голова: потолок 20 с — одна константа в generation-types и storage", () => {
  const types = importTsWith("@/lib/platform/generation-types", {});
  const storage = loadStorage();
  assert.equal(types.STUDENT_LIPSYNC_MAX_SEC, 20);
  assert.equal(types.STUDENT_LIPSYNC_TOLERANCE_SEC, 0.5);
  assert.equal(storage.STUDENT_LIPSYNC_MAX_TEXT, 290);
});

test("говорящая голова: 19,9 с и 20,4 с проходят, длина возвращается", async () => {
  const a = await check(loadStorage(), 19.9);
  assert.equal(a.ok, true);
  assert.ok(Math.abs(a.seconds - 19.9) < 0.01);
  const b = await check(loadStorage(), 20.4);
  assert.equal(b.ok, true);
  assert.ok(Math.abs(b.seconds - 20.4) < 0.01);
});

test("говорящая голова: 20,6 с и 30 с — отказ с измеренной длиной", async () => {
  const a = await check(loadStorage(), 20.6);
  assert.equal(a.ok, false);
  assert.equal(a.reason, "too_long");
  assert.ok(Math.abs(a.seconds - 20.6) < 0.01);
  const b = await check(loadStorage(), 30);
  assert.deepEqual(b, { ok: false, seconds: 30, reason: "too_long" });
});

test("говорящая голова: ведущему без потолка, длина всё равно меряется", async () => {
  const result = await check(loadStorage({ action: "music", prompt: null }), 95, true);
  assert.deepEqual(result, { ok: true, seconds: 95 });
});

test("говорящая голова: длину не узнать (не WAV) — правило длины текста реплики", async () => {
  const short = await check(loadStorage({ action: "voice", prompt: "к".repeat(290) }), null);
  assert.deepEqual(short, { ok: true, seconds: null });
  const long = await check(loadStorage({ action: "voice", prompt: "к".repeat(291) }), null);
  assert.deepEqual(long, { ok: false, seconds: null, reason: "too_long" });
});

test("говорящая голова: ученику — только озвучка (не музыка), длина такой не меряется", async () => {
  const server = wavServer(10);
  const storage = loadStorage({ action: "music", prompt: "lofi" });
  const result = await withFetch(server.fetch, () => storage.checkLipsyncAudio({ staff: false, path: VOICE_PATH, url: SIGNED }));
  assert.deepEqual(result, { ok: false, seconds: null, reason: "not_voice" });
  assert.equal(server.stats.requests, 0);
});

test("длина озвучки кешируется по пути: второй раз Storage не зовём", async () => {
  const storage = loadStorage();
  const server = wavServer(14);
  await withFetch(server.fetch, () => storage.voiceSeconds(VOICE_PATH, SIGNED));
  const again = await withFetch(server.fetch, () => storage.voiceSeconds(VOICE_PATH, SIGNED));
  assert.equal(again, 14);
  assert.equal(server.stats.requests, 1);
});

test("плитки выбора: меряется не больше 12 самых новых озвучек за рендер", async () => {
  const storage = loadStorage();
  const server = wavServer(8);
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `${USER_ID}/${String(i).padStart(8, "0")}-0000-4000-8000-000000000000.wav`, url: SIGNED }));
  const seconds = await withFetch(server.fetch, () => storage.voiceSecondsFor(files));
  assert.equal(storage.VOICE_SECONDS_PER_RENDER, 12);
  assert.equal(seconds.size, 12);
  assert.equal(server.stats.requests, 12);
  assert.ok(seconds.has(files[0].path) && !seconds.has(files[12].path));
});

// ---------- POST /api/generate: lipsync и music ----------

function loadGenerate({ job = VOICE_JOB_ROW, model = "kling/ai-avatar-standard", stars = 60 } = {}) {
  const calls = { debit: [], createTask: [] };
  const mocks = {
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
    "@/lib/server/jobs": { completeJob: async () => true, markJobSubmitted: async () => true, MEDIA_BUCKET: "media" },
    "@/lib/server/moderation": { moderateFields: () => ({ ok: true }) },
    "@/lib/server/prices": {
      canUse: async (user) => ({ ok: true, model, stars: user.role === "student" ? stars : 0, libraryOnly: false }),
      LONG_TEXT_TOKENS: 800,
    },
    "@/lib/server/supabase/admin": adminWith(job),
    // настоящий storage (проверка длины), только права на референсы подменены
    "@/lib/server/storage": (loadReal) => ({
      ...loadReal("@/lib/server/storage"),
      resolveReferences: async (_user, input) => ({
        ok: true,
        refs: {
          urls: { images: ["https://storage.invalid/hero.jpg"], ...(input.audio ? { audio: SIGNED } : {}) },
          stored: { images: input.images, ...(input.audio ? { audio: input.audio } : {}) },
        },
      }),
    }),
    "@/lib/server/wallet": {
      createJobWithDebit: async (args) => (calls.debit.push(args), { ok: true, jobId: LIPSYNC_JOB, balance: 30, reused: false }),
      refundJob: async () => ({ ok: true, refunded: 0, balance: 0 }),
    },
  };
  const mod = importTsWith("@/lib/server/generate", mocks);
  return { mod, calls, run: (user, body) => mod.startGeneration(user, mod.generateRequestSchema.parse(body)) };
}

const LIPSYNC_BODY = {
  action: "lipsync",
  images: [`${USER_ID}/66666666-6666-4666-8666-666666666666.png`],
  audio: VOICE_PATH,
  idempotencyKey: "key-lipsync-0001",
};

test("generate lipsync: 20,6 с — отказ до списания, в ответе длина", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await withFetch(wavServer(20.6).fetch, () => run(STUDENT, LIPSYNC_BODY));
  assert.deepEqual(outcome, { kind: "error", status: 403, error: "lipsync_audio", field: "audio", seconds: 20.6 });
  assert.deepEqual(calls.debit, []);
  assert.deepEqual(calls.createTask, []);
});

test("generate lipsync: 30 с — отказ с seconds: 30", async () => {
  const { run } = loadGenerate();
  const outcome = await withFetch(wavServer(30).fetch, () => run(STUDENT, LIPSYNC_BODY));
  assert.equal(outcome.error, "lipsync_audio");
  assert.equal(outcome.seconds, 30);
});

test("generate lipsync: 19,9 с — списание и задача, длина в params.audioSeconds", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await withFetch(wavServer(19.9).fetch, () => run(STUDENT, LIPSYNC_BODY));
  assert.equal(outcome.kind, "accepted");
  assert.equal(calls.debit.length, 1);
  assert.equal(calls.debit[0].params.audioSeconds, 19.9);
  assert.equal(calls.createTask[0][0].audio, SIGNED);
});

test("generate lipsync: ведущему 60 с можно, длина записана", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await withFetch(wavServer(60).fetch, () => run(TEACHER, LIPSYNC_BODY));
  assert.equal(outcome.kind, "accepted");
  assert.equal(calls.debit[0].params.audioSeconds, 60);
});

test("generate lipsync: длина неизвестна, текст длинный — отказ без seconds (общий текст ошибки)", async () => {
  const { run, calls } = loadGenerate({ job: { action: "voice", prompt: "слово ".repeat(80) } });
  const outcome = await withFetch(wavServer(null).fetch, () => run(STUDENT, LIPSYNC_BODY));
  assert.deepEqual(outcome, { kind: "error", status: 403, error: "lipsync_audio", field: "audio" });
  assert.deepEqual(calls.debit, []);
});

const MUSIC = { action: "music", prompt: "lofi, calm piano", idempotencyKey: "key-music-00001" };

async function musicRequest(body) {
  const { run, calls } = loadGenerate({ model: "ai-music-api/generate", stars: 15 });
  const outcome = await run(STUDENT, { ...MUSIC, ...body });
  assert.equal(outcome.kind, "accepted");
  return { request: calls.createTask[0][0], params: calls.debit[0].params };
}

test("музыка: без вокала — duration уходит, голос и текст песни нет", async () => {
  const { request, params } = await musicRequest({ instrumental: true, lyrics: "ля-ля", duration: 90, vocalGender: "m" });
  assert.equal(request.instrumental, true);
  assert.equal(request.duration, 90);
  assert.equal("vocalGender" in request, false);
  assert.equal("lyrics" in request, false);
  assert.equal(params.duration, 90);
  assert.equal(params.vocalGender, undefined);
});

test("музыка: свой текст — duration 120 и vocalGender f", async () => {
  const { request, params } = await musicRequest({ lyrics: "[Verse]\nСвечи горят", duration: 120, vocalGender: "f" });
  assert.equal(request.lyrics, "[Verse]\nСвечи горят");
  assert.equal(request.duration, 120);
  assert.equal(request.vocalGender, "f");
  assert.equal(params.duration, 120);
  assert.equal(params.vocalGender, "f");
});

test("музыка: свой текст, голос «Любой» — vocalGender нет", async () => {
  const { request } = await musicRequest({ lyrics: "Свечи горят", duration: 60 });
  assert.equal(request.duration, 60);
  assert.equal("vocalGender" in request, false);
});

test("музыка: простой режим (описание) — ни длины, ни голоса", async () => {
  const { request, params } = await musicRequest({ duration: 60, vocalGender: "m" });
  assert.equal("duration" in request, false);
  assert.equal("vocalGender" in request, false);
  assert.equal(params.duration, undefined);
});

test("музыка: схема — duration 121 и vocalGender «x» отклоняются, 10–120 и m/f принимаются", () => {
  const { mod } = loadGenerate();
  const parse = (extra) => mod.generateRequestSchema.safeParse({ ...MUSIC, ...extra }).success;
  assert.equal(parse({ duration: 121 }), false);
  assert.equal(parse({ duration: 9 }), false);
  assert.equal(parse({ duration: 60.5 }), false);
  assert.equal(parse({ vocalGender: "x" }), false);
  for (const duration of [10, 30, 60, 90, 120]) assert.equal(parse({ duration }), true);
  assert.equal(parse({ vocalGender: "m" }), true);
  assert.equal(parse({ vocalGender: "f" }), true);
});
