import assert from "node:assert/strict";
import { importTs, test } from "../../server/bot/tests/harness.mjs";

const {
  withVisibility,
  CLIENT_HIDDEN_MIN_MS,
  jobPollClass,
  gatewayPollIntervalSec,
  isGatewayCheckDue,
  clientBaseDelayMs,
  clientPollDelayMs,
  clientFirstDelayMs,
  crowdFactor,
  UNCERTAIN_AFTER_MS,
} = importTs("@/lib/platform/job-poll");

const S = 1_000;
const M = 60 * S;

test("класс опроса по действию", () => {
  assert.equal(jobPollClass("image"), "fast");
  assert.equal(jobPollClass("image_edit"), "fast");
  assert.equal(jobPollClass("voice"), "fast");
  assert.equal(jobPollClass("video"), "video");
  assert.equal(jobPollClass("motion"), "video");
  assert.equal(jobPollClass("lipsync"), "lipsync");
  assert.equal(jobPollClass("music"), "music");
});

test("сервер: интервал шлюза для картинки и озвучки", () => {
  for (const action of ["image", "image_edit", "voice"]) {
    assert.equal(gatewayPollIntervalSec(action, 0), 5);
    assert.equal(gatewayPollIntervalSec(action, 30 * S), 5);
    assert.equal(gatewayPollIntervalSec(action, 1 * M), 10);
    assert.equal(gatewayPollIntervalSec(action, 3 * M - 1), 10);
    assert.equal(gatewayPollIntervalSec(action, 3 * M), 20);
    assert.equal(gatewayPollIntervalSec(action, 50 * M), 20);
  }
});

test("сервер: видео и перенос движения — первые 30 с шлюз не спрашиваем, потом 10 → 20 → 30 с", () => {
  for (const action of ["video", "motion"]) {
    assert.equal(gatewayPollIntervalSec(action, 0), 30);
    assert.equal(gatewayPollIntervalSec(action, 29 * S), 30);
    assert.equal(gatewayPollIntervalSec(action, 30 * S), 10);
    assert.equal(gatewayPollIntervalSec(action, 2 * M), 10);
    assert.equal(gatewayPollIntervalSec(action, 3 * M), 20);
    assert.equal(gatewayPollIntervalSec(action, 6 * M), 30);
    assert.equal(gatewayPollIntervalSec(action, 59 * M), 30);
  }
});

test("сервер: говорящая голова и музыка", () => {
  assert.equal(gatewayPollIntervalSec("lipsync", 0), 60);
  assert.equal(gatewayPollIntervalSec("lipsync", 59 * S), 60);
  assert.equal(gatewayPollIntervalSec("lipsync", 1 * M), 15);
  assert.equal(gatewayPollIntervalSec("lipsync", 5 * M), 30);
  assert.equal(gatewayPollIntervalSec("music", 0), 20);
  assert.equal(gatewayPollIntervalSec("music", 20 * S), 10);
  assert.equal(gatewayPollIntervalSec("music", 3 * M), 20);
  // часы браузера/сервера в прошлом: отрицательный возраст = только что отправлена
  assert.equal(gatewayPollIntervalSec("video", -5 * S), 30);
});

test("сервер: задача с обратным вызовом — опрос реже, но не реже раза в минуту", () => {
  const cb = { callback: true };
  assert.equal(gatewayPollIntervalSec("image", 0, cb), 15);
  assert.equal(gatewayPollIntervalSec("image", 15 * S, cb), 15);
  assert.equal(gatewayPollIntervalSec("image", 3 * M, cb), 30);
  assert.equal(gatewayPollIntervalSec("music", 0, cb), 30);
  assert.equal(gatewayPollIntervalSec("music", 3 * M, cb), 30);
  for (const action of ["video", "motion"]) {
    assert.equal(gatewayPollIntervalSec(action, 0, cb), 60);
    assert.equal(gatewayPollIntervalSec(action, 59 * S, cb), 60);
    assert.equal(gatewayPollIntervalSec(action, 1 * M, cb), 30);
    assert.equal(gatewayPollIntervalSec(action, 6 * M, cb), 60);
  }
  assert.equal(gatewayPollIntervalSec("lipsync", 0, cb), 60);
  assert.equal(gatewayPollIntervalSec("lipsync", 5 * M, cb), 60);
  // без обратного вызова — прежнее расписание
  assert.equal(gatewayPollIntervalSec("video", 1 * M, { callback: false }), 10);
  assert.equal(gatewayPollIntervalSec("image", 0, {}), 5);
  // потерянный вызов: ни одна ступень не длиннее минуты
  for (const action of ["image", "image_edit", "voice", "music", "video", "motion", "lipsync"]) {
    for (let age = 0; age <= 60 * M; age += 10 * S) assert.ok(gatewayPollIntervalSec(action, age, cb) <= 60);
  }
});

test("сервер: предварительная проверка «пора ли» до RPC", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(isGatewayCheckDue(null, 10, now), true);
  assert.equal(isGatewayCheckDue("не дата", 10, now), true);
  assert.equal(isGatewayCheckDue(ago(10 * S), 10, now), true);
  assert.equal(isGatewayCheckDue(ago(9 * S), 10, now), true); // допуск 1 с, решает claim_job_poll
  assert.equal(isGatewayCheckDue(ago(8 * S), 10, now), false);
  assert.equal(isGatewayCheckDue(ago(0), 30, now), false);
});

test("браузер: пауза по классу, возрасту и статусу", () => {
  assert.equal(clientBaseDelayMs("image", "submitted", 0), 5 * S);
  assert.equal(clientBaseDelayMs("image", "submitted", 1 * M), 10 * S);
  assert.equal(clientBaseDelayMs("image", "submitted", 3 * M), 20 * S);
  assert.equal(clientBaseDelayMs("video", "submitted", 0), 10 * S);
  assert.equal(clientBaseDelayMs("music", "submitted", 0), 10 * S);
  assert.equal(clientBaseDelayMs("lipsync", "submitted", 3 * M), 20 * S);
  assert.equal(clientBaseDelayMs("video", "submitted", 6 * M), 30 * S);
  // копирование — не реже раза в 5 с, чтобы результат появился сразу
  assert.equal(clientBaseDelayMs("video", "storing", 10 * M), 5 * S);
  // queued дольше 20 с: шлюз не подтвердил задачу, до возврата раз в 15 с
  assert.equal(clientBaseDelayMs("video", "queued", UNCERTAIN_AFTER_MS + 1), 15 * S);
  assert.equal(clientBaseDelayMs("image", "queued", 5 * S), 5 * S);
});

test("браузер: разброс, толпа карточек и сбои", () => {
  const base = { action: "image", status: "submitted", ageMs: 0 };
  assert.equal(clientPollDelayMs({ ...base, random: 0 }), 5_000);
  assert.equal(clientPollDelayMs({ ...base, random: 1 }), 6_000); // +20 %
  assert.equal(crowdFactor(1), 1);
  assert.equal(crowdFactor(3), 1);
  assert.equal(crowdFactor(7), 2);
  assert.equal(crowdFactor(24), 3);
  assert.equal(clientPollDelayMs({ ...base, crowd: 24, random: 0 }), 15_000);
  assert.equal(clientPollDelayMs({ ...base, errors: 1, random: 0 }), 10_000);
  assert.equal(clientPollDelayMs({ ...base, errors: 2, random: 0 }), 20_000);
  assert.equal(clientPollDelayMs({ ...base, errors: 10, random: 0 }), 60_000); // потолок
  assert.equal(clientPollDelayMs({ ...base, errors: 10, random: 1 }), 72_000);
});

test("браузер: первый опрос", () => {
  assert.equal(clientFirstDelayMs({ action: "image", status: "queued", ageMs: 0, random: 0 }), 1_500);
  assert.equal(clientFirstDelayMs({ action: "image", status: "submitted", ageMs: 0, random: 0 }), 5_000);
  assert.equal(clientFirstDelayMs({ action: "video", status: "submitted", ageMs: 0, random: 0 }), 10_000);
  // старая задача (кабинет): не дольше 10 с до первой проверки
  assert.equal(clientFirstDelayMs({ action: "video", status: "submitted", ageMs: 2 * 24 * 60 * M, random: 0 }), 10_000);
  // 24 карточки галереи расходятся на 0…6 с
  assert.equal(clientFirstDelayMs({ action: "video", status: "submitted", ageMs: 0, crowd: 24, random: 1 }), 16_000);
});

// ---------- сколько раз сервер спрашивает шлюз за одно видео ----------

/**
 * Модель: задача создана в t = −submitLag, отправлена в kie в t = 0 (last_polled_at = 0),
 * kie готов в t = readyAt. Браузер опрашивает; каждый ответ занимает rtt. Сервер на опросе
 * спрашивает шлюз, если прошло ≥ interval(age) с прошлой проверки (claim_job_poll).
 * Возвращает число проверок статуса у шлюза до той, что увидела success (включительно).
 */
function simulate({ readyAt, nextDelay, firstDelay, serverInterval, rtt = 0.4 * S, submitLag = 2 * S }) {
  let lastCheck = 0;
  let checks = 0;
  let t = -submitLag + firstDelay(submitLag);
  for (let guard = 0; guard < 1_000; guard++) {
    const age = t; // от submitted_at
    if (t - lastCheck >= serverInterval(age) * S) {
      lastCheck = t;
      checks++;
      if (t >= readyAt) return { checks, seenAt: t };
    }
    t += rtt + nextDelay(t + submitLag);
  }
  throw new Error("simulation did not finish");
}

const before = (readyAt) =>
  simulate({ readyAt, firstDelay: () => 5 * S, nextDelay: () => 5 * S, serverInterval: () => 5 });
const after = (readyAt, random = 0.5) =>
  simulate({
    readyAt,
    firstDelay: (age) => clientFirstDelayMs({ action: "video", status: "submitted", ageMs: age, random }),
    nextDelay: (age) => clientPollDelayMs({ action: "video", status: "submitted", ageMs: age, random }),
    serverInterval: (age) => gatewayPollIntervalSec("video", age),
  });
// старая вкладка со старым кодом (опрос раз в 5 с) — сервер всё равно держит своё расписание
const afterOldClient = (readyAt) =>
  simulate({
    readyAt,
    firstDelay: () => 5 * S,
    nextDelay: () => 5 * S,
    serverInterval: (age) => gatewayPollIntervalSec("video", age),
  });

test("2-минутное видео: проверок статуса у шлюза хотя бы вдвое меньше", () => {
  const b = before(120 * S);
  const a = after(120 * S);
  const o = afterOldClient(120 * S);
  console.log(
    `    2 мин видео: было ${b.checks} проверок (увидели в ${(b.seenAt / S).toFixed(1)} с), ` +
      `стало ${a.checks} (в ${(a.seenAt / S).toFixed(1)} с), старый клиент + новый сервер ${o.checks} (в ${(o.seenAt / S).toFixed(1)} с)`,
  );
  assert.ok(b.checks >= 20, `before: ${b.checks}`);
  assert.ok(a.checks * 2 <= b.checks, `after ${a.checks} vs before ${b.checks}`);
  assert.ok(o.checks * 2 <= b.checks, `old client ${o.checks} vs before ${b.checks}`);
  // результат видим не позже чем через ~12 с после готовности
  assert.ok(a.seenAt - 120 * S <= 13 * S, `seen at ${a.seenAt}`);
  for (const random of [0, 1]) {
    const r = after(120 * S, random);
    assert.ok(r.checks * 2 <= b.checks, `random=${random}: ${r.checks}`);
  }
});

test("1- и 3-минутное видео тоже вдвое дешевле", () => {
  for (const sec of [60, 180]) {
    const b = before(sec * S);
    const a = after(sec * S);
    console.log(`    ${sec} с видео: было ${b.checks}, стало ${a.checks}`);
    assert.ok(a.checks * 2 <= b.checks, `${sec}s: after ${a.checks} vs before ${b.checks}`);
  }
});

test("опрос: вкладка в фоне опрашивает редко, но не молчит", () => {
  assert.equal(withVisibility(10_000, true), 10_000);
  assert.equal(withVisibility(10_000, false), CLIENT_HIDDEN_MIN_MS);
  assert.equal(withVisibility(60_000, false), 60_000);
});
