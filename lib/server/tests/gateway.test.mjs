import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Повторы клиента шлюза (lib/server/gateway.ts) на подменённом fetch и подменённых часах:
  сеть и настоящий шлюз не трогаются, паузы не ждём — часы двигаются на величину паузы.
  Аудит 2026-11-08: № 6 (постоянный отказ kie — одна попытка), № 8 (429 — длинные паузы
  с разбросом в пределах бюджета), № 20 (падение n8n на ожидании kie — uncertain).
*/

const gateway = importTsWith("@/lib/server/gateway", {
  "@/lib/server/env": { gatewayConfig: () => ({ mode: "live", url: "http://gateway.invalid/hook", key: "test-key" }) },
  "@/lib/server/mock-media": { mockMedia: () => ({}) },
});

/** Часы: sleep двигает время, каждый вызов шлюза «длится» latencyMs. random — по очереди из списка. */
function fakeClock({ randoms = [0.5], latencyMs = 800 } = {}) {
  let now = 1_000_000;
  let r = 0;
  const sleeps = [];
  const clock = {
    now: () => now,
    random: () => randoms[r++ % randoms.length],
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps, advance: (ms) => (now += ms), latencyMs, started: now, elapsed: () => now - 1_000_000 };
}

/** fetch отвечает по очереди из replies (последний повторяется); пишет тела запросов. */
function stubFetch(time, replies) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push({ at: time.elapsed(), body: JSON.parse(init.body) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    time.advance(reply.latencyMs ?? time.latencyMs);
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return calls;
}

const kieFail = (kieCode, error, extra = {}) => ({
  status: 502,
  body: { ok: false, httpStatus: 502, error, ...(kieCode === undefined ? {} : { kieCode }), ...extra },
});
const VIDEO = { action: "video", prompt: "кот на скейте" };
const TEXT = { model: "claude-haiku-5-5", prompt: "привет" };

// ---------- № 6: постоянные отказы ----------

test("gateway: нет кредитов (kieCode 402) при создании — одна попытка, без пауз, отказ аккаунта", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(402, "Insufficient credits")]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock, jobId: "job-1" });
  assert.equal(calls.length, 1);
  assert.deepEqual(time.sleeps, []);
  assert.equal(result.ok, false);
  assert.equal(result.kieCode, 402);
  assert.equal(gateway.failureKind(result), "permanent");
  assert.equal(gateway.isAccountFailure(result), true);
  assert.equal(result.uncertain, undefined);
});

test("gateway: неверный запрос (kieCode 422) в тексте — одна попытка, без запасных моделей", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(422, "prompt is invalid")]);
  const result = await gateway.generateText(TEXT, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "kimi-k3");
  assert.equal(gateway.isPermanentFailure(result), true);
  assert.equal(gateway.isAccountFailure(result), false);
});

test("gateway: kieCode строкой '401' и текст без kieCode «insufficient credits» — тоже постоянные", async () => {
  const time = fakeClock();
  let calls = stubFetch(time, [kieFail("401", "Unauthorized")]);
  let result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(result.kieCode, 401);
  assert.equal(gateway.isAccountFailure(result), true);

  // текстовый маршрут n8n пока не передаёт kieCode: узнаём по тексту отказа
  calls = stubFetch(time, [kieFail(undefined, "The current balance is insufficient credits")]);
  result = await gateway.generateText(TEXT, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(gateway.isAccountFailure(result), true);
});

test("gateway: собственный отказ шлюза HTTP 400 (модель не из списка) не повторяется", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [{ status: 400, body: { ok: false, error: "model x is not allowed" } }]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(gateway.failureKind(result), "permanent");
  assert.equal(gateway.isAccountFailure(result), false);
});

// ---------- № 8: 429 ----------

test("gateway: 429 при создании — паузы ~10/12 с ±30 %, растут, всё в бюджете 45 с", async () => {
  const time = fakeClock({ randoms: [0.5] });
  const calls = stubFetch(time, [kieFail(429, "Too many requests")]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock, jobId: "job-2" });
  assert.equal(result.ok, false);
  assert.equal(gateway.failureKind(result), "rate_limited");
  assert.deepEqual(time.sleeps, [10_000, 12_000]);
  assert.equal(calls.length, 3);
  // каждая попытка стартует, когда до конца бюджета ≥ 10 с, и вся серия укладывается в 45 с
  for (const call of calls) assert.ok(call.at <= 45_000 - 10_000, `attempt at ${call.at}`);
  assert.ok(time.elapsed() <= 45_000, `elapsed ${time.elapsed()}`);
  // один и тот же jobId во всех попытках
  assert.deepEqual(calls.map((c) => c.body.jobId), ["job-2", "job-2", "job-2"]);
});

test("gateway: 429 — разброс: разные ученики повторяют в разные секунды, в пределах ±30 %", async () => {
  const runs = [];
  for (const randoms of [[0], [1], [0.13, 0.77, 0.4], [0.9, 0.05, 0.6]]) {
    const time = fakeClock({ randoms });
    stubFetch(time, [kieFail(429, "Too many requests")]);
    await gateway.createTask(VIDEO, { clock: time.clock });
    const bases = [10_000, 12_000, 14_000];
    time.sleeps.forEach((ms, i) => {
      assert.ok(ms >= bases[i] * 0.7 && ms <= bases[i] * 1.3, `delay ${i} = ${ms}`);
      assert.ok(ms >= 7_000, "не короче окна kie с учётом разброса");
    });
    assert.ok(time.elapsed() <= 45_000, `elapsed ${time.elapsed()}`);
    runs.push(time.sleeps.join(","));
  }
  assert.equal(new Set(runs).size, runs.length, `паузы совпали: ${runs.join(" | ")}`);
  // крайние значения: 7 000 и 13 000 мс перед второй попыткой
  assert.equal(runs[0].split(",")[0], "7000");
  assert.equal(runs[1].split(",")[0], "13000");
});

test("gateway: 429 в тексте — длинные паузы, цепочка моделей по порядку, бюджет 42 с", async () => {
  const time = fakeClock({ randoms: [0.5] });
  const calls = stubFetch(time, [kieFail(undefined, "429 Too Many Requests")]);
  const result = await gateway.generateText(TEXT, { clock: time.clock });
  assert.equal(result.ok, false);
  assert.deepEqual(time.sleeps, [10_000, 12_000]);
  assert.deepEqual(calls.map((c) => c.body.model), ["kimi-k3", "kimi-k3", "claude-haiku-5-5"]);
  assert.ok(time.elapsed() <= 42_000);
});

test("gateway: после 429 следующий ответ успешный — задача создана", async () => {
  const time = fakeClock({ randoms: [0.2] });
  const calls = stubFetch(time, [kieFail(429, "Too many requests"), { body: { ok: true, taskId: "t-1", state: "queued" } }]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "t-1");
  assert.equal(calls.length, 2);
  assert.equal(time.sleeps[0], Math.round(10_000 * (0.7 + 0.6 * 0.2)));
});

// ---------- 5xx: как было ----------

test("gateway: 5xx «Resources are tight» при создании — 4 попытки, паузы 1,5/3/5 с", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(undefined, "Resources are tight, please try again later")]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 4);
  assert.deepEqual(time.sleeps, [1500, 3000, 5000]);
  assert.equal(gateway.failureKind(result), "transient");
  assert.equal(result.uncertain, undefined);
});

test("gateway: kieCode 500 и kieCode 200 без taskId (HTTP 502) — временные, повторяются", async () => {
  for (const kieCode of [500, 200]) {
    const time = fakeClock();
    const calls = stubFetch(time, [kieFail(kieCode, "server error")]);
    await gateway.createTask(VIDEO, { clock: time.clock });
    assert.equal(calls.length, 4, `kieCode ${kieCode}`);
  }
});

test("gateway: 5xx в тексте — 5 попыток по цепочке Kimi → Kimi → Haiku → Kimi → GPT, паузы 1,5/3/5/8 с", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(undefined, "Resources are tight"), kieFail(undefined, "Resources are tight")]);
  await gateway.generateText(TEXT, { clock: time.clock });
  assert.deepEqual(
    calls.map((c) => c.body.model),
    ["kimi-k3", "kimi-k3", "claude-haiku-5-5", "kimi-k3", "gpt-6-luna"],
  );
  assert.deepEqual(time.sleeps, [1500, 3000, 5000, 8000]);
});

test("gateway: 504 без JSON при создании — повторяется (не uncertain), как раньше", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [{ status: 504, raw: "<html>Gateway Timeout</html>" }]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 4);
  assert.equal(result.error, "gateway_bad_response");
  assert.equal(result.uncertain, false);
});

// ---------- № 20: n8n упал на ожидании kie ----------

test("gateway: «Error in workflow» (без ok) через 40 с — uncertain, без повтора; через 1 с — повтор", async () => {
  const crash = { status: 500, body: { code: 0, message: "Error in workflow" } };
  let time = fakeClock();
  let calls = stubFetch(time, [{ ...crash, latencyMs: 40_200 }]);
  let result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(result.uncertain, true);
  assert.equal(gateway.failureKind(result), "final");

  time = fakeClock();
  calls = stubFetch(time, [{ ...crash, latencyMs: 1_000 }]);
  result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 4);
  assert.notEqual(result.uncertain, true);
});

test("gateway: шлюз сам сообщил uncertain: true — без повтора", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(undefined, "kie timeout", { uncertain: true, httpStatus: 504 })]);
  const result = await gateway.createTask(VIDEO, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(result.uncertain, true);
});

test("gateway: «перегружен» с кодом 4xx — временный отказ, а нет кредитов — постоянный даже с этим текстом", () => {
  assert.equal(gateway.failureKind({ ok: false, error: "Resources are tight, please try again later", httpStatus: 502, kieCode: 422 }), "transient");
  assert.equal(gateway.failureKind({ ok: false, error: "Insufficient credits, try again later", httpStatus: 502, kieCode: 402 }), "permanent");
});

// ---------- картинки в тексте (проверка домашки, 16 ноября) ----------

const IMG = (n) => `https://storage.test/storage/v1/object/sign/media/u/${n}.jpg?token=t${n}`;
const textOk = { body: { ok: true, text: "ответ", model: "kimi-k3", credits: 1 } };

test("gateway: без картинок поля images в запросе нет (и при пустом списке), цепочка прежняя", async () => {
  for (const extra of [{}, { images: [] }, { images: ["http://insecure.test/a.jpg", "data:image/png;base64,AAAA"] }]) {
    const time = fakeClock();
    const calls = stubFetch(time, [textOk]);
    const result = await gateway.generateText({ ...TEXT, ...extra }, { clock: time.clock });
    assert.equal(result.ok, true);
    assert.equal("images" in calls[0].body, false, JSON.stringify(extra));
    assert.equal(calls[0].body.model, "kimi-k3");
  }
  assert.deepEqual(gateway.textChain("claude-haiku-5-5", false), ["kimi-k3", "kimi-k3", "claude-haiku-5-5", "kimi-k3", "gpt-6-luna"]);
  assert.deepEqual(gateway.textChain("claude-sonnet-5-5", false), Array(5).fill("claude-sonnet-5-5"));
});

test("gateway: картинки уходят полем images (только https, без повторов, не больше 6) во всех попытках", async () => {
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(undefined, "Resources are tight"), textOk]);
  const list = [IMG(1), IMG(1), "http://x.test/a.jpg", IMG(2), IMG(3), IMG(4), IMG(5), IMG(6), IMG(7)];
  const result = await gateway.generateText({ ...TEXT, images: list }, { clock: time.clock });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.body.images, [1, 2, 3, 4, 5, 6].map(IMG));
});

test("gateway: с картинками цепочка — только модели, где картинки документированы (Kimi K3, GPT 6 Luna)", async () => {
  assert.deepEqual([...gateway.VISION_TEXT_MODELS], ["kimi-k3", "gpt-6-luna"]);
  assert.deepEqual(gateway.textChain("claude-haiku-5-5", true), ["kimi-k3", "kimi-k3", "kimi-k3", "gpt-6-luna"]);
  assert.deepEqual(gateway.textChain("gpt-6-luna", true), Array(5).fill("gpt-6-luna"));
  assert.deepEqual(gateway.textChain("claude-sonnet-5-5", true), ["kimi-k3", "kimi-k3", "kimi-k3", "gpt-6-luna"], "модель без картинок не просится");
  const time = fakeClock();
  const calls = stubFetch(time, [kieFail(undefined, "Resources are tight")]);
  await gateway.generateText({ ...TEXT, images: [IMG(1)] }, { clock: time.clock });
  assert.deepEqual(calls.map((c) => c.body.model), ["kimi-k3", "kimi-k3", "kimi-k3", "gpt-6-luna"]);
  assert.ok(!calls.some((c) => c.body.model.startsWith("claude")), "Claude картинок не получает");
});

test("gateway: отказ из-за картинки — одна попытка, imagesRejected; тот же текст без картинок — как раньше, повторы", async () => {
  let time = fakeClock();
  let calls = stubFetch(time, [kieFail(undefined, "Cannot download image [https://…] ...")]);
  const result = await gateway.generateText({ ...TEXT, images: [IMG(1)] }, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(result.imagesRejected, true);
  assert.equal(gateway.failureKind(result), "permanent");
  assert.equal(gateway.isAccountFailure(result), false, "это не отказ аккаунта");

  // собственный отказ шлюза («Доработка запроса» не приняла ссылку)
  time = fakeClock();
  calls = stubFetch(time, [{ status: 400, body: { ok: false, httpStatus: 400, error: "images: only https links to storage" } }]);
  const own = await gateway.generateText({ ...TEXT, images: [IMG(1)] }, { clock: time.clock });
  assert.equal(calls.length, 1);
  assert.equal(own.imagesRejected, true);

  time = fakeClock();
  calls = stubFetch(time, [kieFail(undefined, "Cannot download image")]);
  const plain = await gateway.generateText(TEXT, { clock: time.clock });
  assert.equal(plain.imagesRejected, undefined);
  assert.equal(calls.length, 5, "без картинок поведение не менялось");
});
