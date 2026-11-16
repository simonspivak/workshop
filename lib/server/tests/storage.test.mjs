import assert from "node:assert/strict";
import { importTs, importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Кеш подписанных ссылок (lib/server/signed-url-cache.ts, storage.ts) и срок сохранения
  результата в job-progress — на подменах: Storage, база и шлюз не трогаются.
  Аудит 2026-11-08: № 17 / № 3 (ссылки переиспользуются, права проверяются до кеша),
  № 21 (срок 55 с от начала запроса доходит до скачивания и загрузки).
*/

const { createSignedUrlCache, SIGNED_URL_REUSE_MARGIN_MS } = importTs("@/lib/server/signed-url-cache");

const HOUR = 60 * 60;
const MIN = 60_000;

function fakeSigner() {
  let n = 0;
  const calls = [];
  const signer = async (paths, ttl) => {
    calls.push({ paths: [...paths], ttl });
    return new Map(paths.filter((p) => !p.includes("missing")).map((p) => [p, `https://signed.invalid/${p}?token=t${++n}`]));
  };
  return { signer, calls };
}

test("кеш ссылок: повторный рендер в течение 45 минут получает ту же ссылку, Storage не зовём", async () => {
  let now = 1_000_000;
  const cache = createSignedUrlCache({ ttlSec: HOUR, now: () => now });
  const { signer, calls } = fakeSigner();
  const first = await cache.sign(["u1/a.jpg", "u1/b.mp4"], signer);
  now += 44 * MIN;
  const again = await cache.sign(["u1/b.mp4", "u1/a.jpg", "u1/a.jpg"], signer);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { paths: ["u1/a.jpg", "u1/b.mp4"], ttl: HOUR });
  assert.equal(again.get("u1/a.jpg").url, first.get("u1/a.jpg").url);
  assert.equal(again.get("u1/a.jpg").expiresAt, 1_000_000 + HOUR * 1000);
});

test("кеш ссылок: когда до истечения ≤ 15 минут, ссылка подписывается заново", async () => {
  let now = 1_000_000;
  const cache = createSignedUrlCache({ ttlSec: HOUR, now: () => now });
  const { signer, calls } = fakeSigner();
  const first = await cache.sign(["u1/a.jpg"], signer);
  now += HOUR * 1000 - SIGNED_URL_REUSE_MARGIN_MS; // ровно 15 минут до конца — уже не берём
  const second = await cache.sign(["u1/a.jpg"], signer);
  assert.equal(calls.length, 2);
  assert.notEqual(second.get("u1/a.jpg").url, first.get("u1/a.jpg").url);
  assert.equal(second.get("u1/a.jpg").expiresAt, now + HOUR * 1000);
  assert.ok(SIGNED_URL_REUSE_MARGIN_MS === 15 * MIN);
});

test("кеш ссылок: любая выданная ссылка живёт ещё больше 15 минут", async () => {
  let now = 0;
  const cache = createSignedUrlCache({ ttlSec: HOUR, now: () => now });
  const { signer } = fakeSigner();
  for (let minute = 0; minute <= 180; minute += 1) {
    now = minute * MIN;
    const entry = (await cache.sign(["u1/a.jpg"], signer)).get("u1/a.jpg");
    assert.ok(entry.expiresAt - now > 15 * MIN, `минута ${minute}: осталось ${(entry.expiresAt - now) / MIN} мин`);
  }
});

test("кеш ссылок: только недостающие пути идут в Storage; неподписанный путь не кешируется", async () => {
  const cache = createSignedUrlCache({ ttlSec: HOUR, now: () => 0 });
  const { signer, calls } = fakeSigner();
  await cache.sign(["u1/a.jpg"], signer);
  const result = await cache.sign(["u1/a.jpg", "u1/c.jpg", "u1/missing.jpg"], signer);
  assert.deepEqual(calls[1].paths, ["u1/c.jpg", "u1/missing.jpg"]);
  assert.equal(result.has("u1/missing.jpg"), false);
  await cache.sign(["u1/missing.jpg"], signer);
  assert.deepEqual(calls[2].paths, ["u1/missing.jpg"]);
});

test("кеш ссылок: не больше maxEntries, вытесняется давно не нужная; forget убирает ссылку", async () => {
  const cache = createSignedUrlCache({ ttlSec: HOUR, maxEntries: 2, now: () => 0 });
  const { signer, calls } = fakeSigner();
  await cache.sign(["a", "b"], signer);
  await cache.sign(["a"], signer); // a — свежая
  await cache.sign(["c"], signer); // вытесняет b
  assert.equal(cache.size(), 2);
  await cache.sign(["a"], signer);
  assert.equal(calls.length, 2);
  await cache.sign(["b"], signer);
  assert.equal(calls.length, 3);
  cache.forget(["b"]);
  await cache.sign(["b"], signer);
  assert.equal(calls.length, 4);
});

test("кеш ссылок: запас должен быть меньше срока ссылки", () => {
  assert.throws(() => createSignedUrlCache({ ttlSec: 60, marginMs: 60_000 }));
});

// ---------- storage.ts и job-progress.ts на подменах ----------

function fakeAdmin() {
  let n = 0;
  const signCalls = [];
  const client = {
    storage: {
      from: () => ({
        createSignedUrls: async (paths, ttl) => {
          signCalls.push({ paths: [...paths], ttl });
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.invalid/${p}?token=t${++n}`, error: null })), error: null };
        },
      }),
    },
  };
  return { client, signCalls };
}

function loadProgress({ gateway = {}, jobs = {}, wallet = {}, afterTasks = [] } = {}) {
  const admin = fakeAdmin();
  const createdUntil = [];
  const mod = importTsWith("@/lib/server/job-progress", {
    "next/server": { after: (fn) => afterTasks.push(fn()) },
    "@/lib/server/dal/auth": { isStaff: (user) => user.role !== "student" },
    "@/lib/server/dal/teacher": { isUuid: (v) => /^[0-9a-f-]{36}$/.test(v) },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => admin.client,
      createAdminClientUntil: (deadline) => {
        createdUntil.push(deadline);
        return admin.client;
      },
    },
    "@/lib/server/gateway": { downloadResult: async () => ({ ok: false, error: "download_failed" }), getTaskStatus: async () => ({ ok: false }), ...gateway },
    "@/lib/server/jobs": {
      MEDIA_BUCKET: "media",
      mediaPath: (u, j, ext) => `${u}/${j}.${ext}`,
      claimJobPoll: async () => true,
      beginJobStoring: async () => true,
      completeJob: async () => true,
      ...jobs,
    },
    "@/lib/server/wallet": { refundJob: async () => ({ ok: true, refunded: 0, balance: 0 }), ...wallet },
  });
  return { mod, admin, createdUntil };
}

const job = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "u1",
  group_id: "g1",
  action: "image",
  model: "m",
  status: "done",
  stars: 2,
  prompt: "кот",
  result_text: null,
  storage_path: "u1/11111111-1111-4111-8111-111111111111.jpg",
  extra_paths: [],
  mime_type: "image/jpeg",
  error: null,
  hidden: false,
  deleted_at: null,
  gateway_task_id: "task-1",
  lesson_id: null,
  task_ref: null,
  created_at: new Date(Date.now() - 10 * MIN).toISOString(),
  updated_at: new Date(Date.now() - 10 * MIN).toISOString(),
  submitted_at: new Date(Date.now() - 10 * MIN).toISOString(),
  completed_at: null,
  last_polled_at: null,
  ...over,
});

test("toJobViews: повторный рендер отдаёт ту же ссылку (браузер берёт файл из кеша)", async () => {
  const { mod, admin } = loadProgress();
  const first = await mod.toJobViews([job()]);
  const second = await mod.toJobViews([job()]);
  assert.equal(admin.signCalls.length, 1);
  assert.equal(admin.signCalls[0].ttl, 3600);
  assert.equal(first[0].media[0].url, second[0].media[0].url);
});

test("toJobViews: ссылка из кеша не достаётся тому, кому файл не положен (скрытый результат)", async () => {
  const { mod } = loadProgress();
  const hidden = job({ hidden: true });
  // ведущий открыл скрытый результат — ссылка легла в кеш
  const teacher = await mod.toJobViews([hidden], { revealHidden: true });
  assert.equal(teacher[0].media.length, 1);
  // ученик (владелец) видит карточку без файла: проверка прав — до кеша
  const student = await mod.toJobViews([hidden]);
  assert.deepEqual(student[0].media, []);
  assert.equal(student[0].hidden, true);
  // незавершённая задача тоже без файлов, даже если путь уже в кеше
  const storing = await mod.toJobViews([job({ status: "storing" })]);
  assert.deepEqual(storing[0].media, []);
});

test("signMediaPaths: короткие ссылки (проверка файла сервером) мимо кеша", async () => {
  const admin = fakeAdmin();
  const storage = importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": { createAdminClient: () => admin.client, createAdminClientUntil: () => admin.client },
  });
  await storage.signMediaPaths(["u1/a.wav"], 60);
  await storage.signMediaPaths(["u1/a.wav"], 60);
  assert.equal(admin.signCalls.length, 2);
  const withExpiry = await storage.signMediaPathsWithExpiry(["u1/b.jpg"]);
  assert.ok(withExpiry.get("u1/b.jpg").expiresAt > Date.now() + 59 * MIN);
  await storage.signMediaPaths(["u1/b.jpg"]);
  assert.equal(admin.signCalls.length, 3);
  storage.forgetSignedUrls(["u1/b.jpg"]);
  await storage.signMediaPaths(["u1/b.jpg"]);
  assert.equal(admin.signCalls.length, 4);
});

test("signMediaPaths: fresh (референсы для шлюза) — мимо кеша, ссылка на полный час", async () => {
  const admin = fakeAdmin();
  const storage = importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": { createAdminClient: () => admin.client, createAdminClientUntil: () => admin.client },
  });
  await storage.signMediaPaths(["u1/c.jpg"]);
  assert.equal(admin.signCalls.length, 1);
  const fresh = await storage.signMediaPathsWithExpiry(["u1/c.jpg"], storage.SIGNED_URL_TTL_SEC, { fresh: true });
  assert.equal(admin.signCalls.length, 2, "fresh всегда идёт в Storage");
  assert.ok(fresh.get("u1/c.jpg").expiresAt > Date.now() + 59 * MIN);
  await storage.signMediaPaths(["u1/c.jpg"]);
  assert.equal(admin.signCalls.length, 2, "обычный рендер по-прежнему из кеша");
});

test("uploadMedia: срок вышел — загрузка не начинается, upload_failed", async () => {
  let clients = 0;
  const storage = importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => (clients++, {}),
      createAdminClientUntil: () => (clients++, {}),
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const result = await storage.uploadMedia("u1/a.jpg", new Uint8Array(4), "image/jpeg", { deadline: Date.now() + 500 });
    assert.deepEqual(result, { ok: false, error: "upload_failed" });
    assert.equal(clients, 0);
  } finally {
    console.error = original;
  }
});

test("uploadMedia: обрыв по сроку (клиент бросил) — upload_failed, а не исключение", async () => {
  const thrower = { storage: { from: () => ({ upload: async () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })) }) } };
  const used = [];
  const storage = importTsWith("@/lib/server/storage", {
    "@/lib/server/dal/auth": { isStaff: () => false },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "@/lib/server/supabase/admin": {
      createAdminClient: () => assert.fail("без срока не ждали"),
      createAdminClientUntil: (deadline) => (used.push(deadline), thrower),
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const deadline = Date.now() + 30_000;
    const result = await storage.uploadMedia("u1/a.jpg", new Uint8Array(4), "image/jpeg", { deadline });
    assert.deepEqual(result, { ok: false, error: "upload_failed" });
    assert.deepEqual(used, [deadline]);
  } finally {
    console.error = original;
  }
});

test("advanceJob: срок запроса доходит до скачивания; обрыв оставляет задачу в storing без возврата", async () => {
  const afterTasks = [];
  const downloads = [];
  const refunds = [];
  const completes = [];
  const { mod } = loadProgress({
    afterTasks,
    gateway: {
      getTaskStatus: async () => ({ ok: true, state: "success", done: true, urls: ["https://x.aiquickdraw.com/r.mp4"], credits: 10, lastFrame: null }),
      downloadResult: async (url, maxBytes, options) => {
        downloads.push({ url, maxBytes, options });
        return { ok: false, error: "download_failed" };
      },
    },
    jobs: { completeJob: async (...args) => (completes.push(args), true) },
    wallet: { refundJob: async (...args) => (refunds.push(args), { ok: true, refunded: 2, balance: 0 }) },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const deadline = Date.now() + 55_000;
    const next = await mod.advanceJob(
      job({ status: "submitted", storage_path: null, last_polled_at: new Date(Date.now() - 5 * MIN).toISOString() }),
      { deadline },
    );
    await Promise.all(afterTasks);
    assert.equal(next.status, "storing");
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].options.deadline, deadline);
    assert.deepEqual(refunds, []);
    assert.deepEqual(completes, []);
  } finally {
    console.error = original;
  }
});

test("advanceJob: без срока от маршрута — 55 с от вызова", async () => {
  const afterTasks = [];
  const downloads = [];
  const { mod } = loadProgress({
    afterTasks,
    gateway: {
      getTaskStatus: async () => ({ ok: true, state: "success", done: true, urls: ["https://x.aiquickdraw.com/r.jpg"], credits: 1, lastFrame: null }),
      downloadResult: async (_url, _max, options) => (downloads.push(options.deadline), { ok: false, error: "download_failed" }),
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const before = Date.now();
    await mod.advanceJob(job({ status: "submitted", storage_path: null, last_polled_at: null }));
    await Promise.all(afterTasks);
    assert.ok(downloads[0] >= before + 55_000 && downloads[0] <= Date.now() + 55_000);
  } finally {
    console.error = original;
  }
});
