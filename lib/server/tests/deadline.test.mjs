import assert from "node:assert/strict";
import { importTs, importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Общий срок скачивания результата (аудит 2026-11-08, № 21): downloadResult и fetchUntil
  на подменённом fetch, который честно слушает signal. Сеть не трогается.
*/

const gateway = importTsWith("@/lib/server/gateway", {
  "@/lib/server/env": { gatewayConfig: () => ({ mode: "live", url: "http://gateway.invalid/hook", key: "test-key" }) },
  "@/lib/server/mock-media": { mockMedia: () => ({}) },
});
const { fetchUntil, deadlineSignal, MIN_STEP_MS } = importTs("@/lib/server/deadline");

const RESULT = "https://tempfile.aiquickdraw.com/r/result.jpg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1]);

/** fetch, который не отвечает, пока его не оборвут через signal. */
function hangingFetch(calls) {
  return (_url, init) => {
    calls.push(init);
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };
}

/** fetch отвечает сразу, а тело файла «зависает» на середине до обрыва. */
function stallingBodyFetch(calls) {
  return async (_url, init) => {
    calls.push(init);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(JPEG);
        init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
      },
    });
    return new Response(body, { status: 200 });
  };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  // таймеры AbortSignal.timeout не держат процесс: без этого node выйдет, не дождавшись обрыва
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    return await fn();
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = original;
  }
}

test("downloadResult: срок уже вышел — даже не начинаем, download_failed (повтор по правилам опроса)", async () => {
  const calls = [];
  const result = await withFetch(hangingFetch(calls), () =>
    gateway.downloadResult(RESULT, undefined, { deadline: Date.now() + MIN_STEP_MS - 1 }),
  );
  assert.deepEqual(result, { ok: false, error: "download_failed" });
  assert.equal(calls.length, 0);
});

test("downloadResult: зависший ответ kie обрывается к сроку, а не через 60 с", async () => {
  const calls = [];
  const started = Date.now();
  const result = await withFetch(hangingFetch(calls), () =>
    gateway.downloadResult(RESULT, undefined, { deadline: started + 1_300 }),
  );
  const took = Date.now() - started;
  assert.deepEqual(result, { ok: false, error: "download_failed" });
  assert.equal(calls.length, 1);
  assert.ok(took >= 1_000 && took < 3_000, `оборвалось через ${took} мс`);
});

test("downloadResult: зависшее тело файла тоже обрывается к сроку", async () => {
  const calls = [];
  const started = Date.now();
  const result = await withFetch(stallingBodyFetch(calls), () =>
    gateway.downloadResult(RESULT, undefined, { deadline: started + 1_300 }),
  );
  assert.deepEqual(result, { ok: false, error: "download_failed" });
  assert.ok(Date.now() - started < 3_000);
});

test("downloadResult: без срока и с запасом — файл скачивается как раньше", async () => {
  const reply = async () => new Response(JPEG, { status: 200 });
  const plain = await withFetch(reply, () => gateway.downloadResult(RESULT));
  assert.equal(plain.ok, true);
  assert.equal(plain.contentType, "image/jpeg");
  const timed = await withFetch(reply, () => gateway.downloadResult(RESULT, undefined, { deadline: Date.now() + 55_000 }));
  assert.equal(timed.ok, true);
  assert.equal(timed.ext, "jpg");
});

test("deadlineSignal: без срока — потолок хопа 60 с; срок ближе потолка — срок", () => {
  assert.equal(deadlineSignal(Date.now() + 500), null);
  const capped = deadlineSignal(undefined, 60_000);
  assert.ok(capped instanceof AbortSignal && !capped.aborted);
  assert.ok(deadlineSignal(Date.now() + 5_000, 60_000) instanceof AbortSignal);
});

test("fetchUntil: запрос Storage обрывается к сроку и сохраняет свой signal", async () => {
  const calls = [];
  const started = Date.now();
  await withFetch(hangingFetch(calls), async () => {
    await assert.rejects(fetchUntil(started + 300)("http://storage.invalid/upload", { method: "POST" }));
  });
  assert.ok(Date.now() - started < 2_000);
  const own = new AbortController();
  await withFetch(hangingFetch(calls), async () => {
    const pending = fetchUntil(Date.now() + 30_000)("http://storage.invalid/upload", { signal: own.signal });
    own.abort();
    await assert.rejects(pending);
  });
});
