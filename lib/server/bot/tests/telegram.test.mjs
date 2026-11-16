import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { importTs, importTsWith, test } from "./harness.mjs";

/*
  Вебхук Telegram (app/api/tg/[botId]/route.ts) и разбор команд (lib/server/bot/telegram-flow.ts)
  на подменах: проверка секрета, ленивое снятие вебхука после срока, /start и привязка владельца.
*/

process.env.BOT_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "s3cret-token_value";
const sha = (v) => createHash("sha256").update(v).digest("hex");

function makeBot({ endsOn = null, ageBand = "adult", active = true, paused = false } = {}) {
  const { encryptSecret } = importTs("@/lib/server/crypto");
  return {
    id: BOT_ID,
    ownerId: "o",
    slug: "fira",
    name: "Тётя Фира",
    soul: "Приветствие: «Золотце, я тётя Фира.»",
    knowledge: "",
    tools: { leads: false, image: false, knowledge: false, leadForm: null },
    avatarJobId: null,
    active,
    paused,
    createdAt: "",
    telegram: {
      botId: 777,
      username: "fira_test_bot",
      token: encryptSecret("123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      secretHash: sha(SECRET),
      ownerChatId: null,
      connectedAt: "2026-11-02T10:00:00.000000+00:00",
    },
    owner: {
      id: "o",
      role: "student",
      ageBand,
      parentalConsent: false,
      disabled: false,
      nickname: "fira",
      group: { id: "g", code: "md1", endsOn, paused: false, allowGoogleMinors: false },
    },
  };
}

function loadRoute(bot) {
  const calls = { after: [], plans: [], retired: [], sent: [], replies: [] };
  const route = importTsWith("@/app/api/tg/[botId]/route", {
    "next/server": { after: (fn) => calls.after.push(fn) },
    "@/lib/server/dal/teacher": { isUuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) },
    "@/lib/server/bot/store": (loadReal) => ({ ...loadReal("@/lib/server/bot/store"), loadBotById: async () => bot }),
    "@/lib/server/bot/telegram-flow": {
      planTelegramMessage: async (_bot, message) => {
        calls.plans.push(message);
        return { kind: "send", text: "привет" };
      },
      retireTelegram: async (_bot, reason) => calls.retired.push(reason),
      sendTelegramText: async (_bot, chatId, text) => calls.sent.push([chatId, text]),
      runTelegramReply: async () => calls.replies.push(true),
    },
  });
  return { route, calls };
}

const update = { update_id: 1001, message: { message_id: 5, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, text: "Привет" } };

function request(secret, body = update) {
  return new Request(`https://example.com/api/tg/${BOT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ botId: BOT_ID }) };

test("вебхук: без секрета и с чужим секретом — 401, сообщение не обрабатывается", async () => {
  const { route, calls } = loadRoute(makeBot());
  assert.equal((await route.POST(request(null), ctx)).status, 401);
  assert.equal((await route.POST(request("wrong"), ctx)).status, 401);
  assert.equal((await route.POST(request(SECRET + "x"), ctx)).status, 401);
  assert.equal(calls.plans.length, 0);
});

test("вебхук: отключённый бот (нет хеша секрета) — 401", async () => {
  const bot = makeBot();
  bot.telegram.secretHash = null;
  const { route } = loadRoute(bot);
  assert.equal((await route.POST(request(SECRET), ctx)).status, 401);
});

test("вебхук: верный секрет — 200 сразу, ответ в after()", async () => {
  const { route, calls } = loadRoute(makeBot());
  const response = await route.POST(request(SECRET), ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.plans[0], { updateId: 1001, chatId: 42, chatType: "private", fromIsBot: false, text: "Привет" });
  assert.equal(calls.sent.length, 0, "отправка ещё не началась");
  await Promise.all(calls.after.map((fn) => fn()));
  assert.deepEqual(calls.sent, [[42, "привет"]]);
});

test("вебхук: срок бота вышел — вебхук снимается лениво, ответа гостю нет", async () => {
  const { route, calls } = loadRoute(makeBot({ endsOn: "2020-01-01" }));
  assert.equal((await route.POST(request(SECRET), ctx)).status, 200);
  assert.equal(calls.plans.length, 0);
  await Promise.all(calls.after.map((fn) => fn()));
  assert.deepEqual(calls.retired, ["expired"]);
});

test("вебхук: владельцу больше нет 18 — Telegram отключается", async () => {
  const { route, calls } = loadRoute(makeBot({ ageBand: "16_17" }));
  assert.equal((await route.POST(request(SECRET), ctx)).status, 200);
  await Promise.all(calls.after.map((fn) => fn()));
  assert.deepEqual(calls.retired, ["not_adult"]);
});

test("вебхук: бот на паузе — Telegram не отключается, сообщение идёт в обработку (ответ «на паузе» даёт мозг)", async () => {
  const { route, calls } = loadRoute(makeBot({ paused: true }));
  assert.equal((await route.POST(request(SECRET), ctx)).status, 200);
  assert.equal(calls.plans.length, 1);
  await Promise.all(calls.after.map((fn) => fn()));
  assert.deepEqual(calls.retired, []);
});

test("вебхук: не сообщение и битое тело — 200 без обработки", async () => {
  const { route, calls } = loadRoute(makeBot());
  assert.equal((await route.POST(request(SECRET, { update_id: 1, edited_message: {} }), ctx)).status, 200);
  const broken = new Request(`https://example.com/api/tg/${BOT_ID}`, {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": SECRET },
    body: "{not json",
  });
  assert.equal((await route.POST(broken, ctx)).status, 200);
  assert.equal(calls.plans.length, 0);
});

test("вебхук: неверный id бота — 404", async () => {
  const { route } = loadRoute(makeBot());
  assert.equal((await route.POST(request(SECRET), { params: Promise.resolve({ botId: "../etc" }) })).status, 404);
});

// ---------- команды ----------

function loadFlow() {
  const calls = { accepted: [], ownerChat: [] };
  const flow = importTsWith("@/lib/server/bot/telegram-flow", {
    "@/lib/server/audit": { audit: async () => undefined },
    "@/lib/server/bot/brain": {
      acceptMessage: async (input) => {
        calls.accepted.push(input);
        return { status: "accepted", messageId: 9 };
      },
      completeMessage: async () => ({ status: "ok", text: "ответ", stars: 1, lead: null, card: null }),
    },
    "@/lib/server/bot/store": (loadReal) => ({
      ...loadReal("@/lib/server/bot/store"),
      setTelegramOwnerChat: async (_id, chatId) => calls.ownerChat.push(chatId),
      wipeTelegram: async () => undefined,
    }),
  });
  return { flow, calls };
}

const msg = (text, extra = {}) => ({ updateId: 5, chatId: 42, chatType: "private", fromIsBot: false, text, ...extra });

test("Telegram: /start — приветствие из характера, без модели и звёзд", async () => {
  const { flow, calls } = loadFlow();
  assert.deepEqual(await flow.planTelegramMessage(makeBot(), msg("/start")), { kind: "send", text: "Золотце, я тётя Фира." });
  assert.deepEqual(await flow.planTelegramMessage(makeBot(), msg("/start@fira_test_bot")), { kind: "send", text: "Золотце, я тётя Фира." });
  assert.equal(calls.accepted.length, 0);
});

test("Telegram: привязка чата владельца по коду из deep link", async () => {
  const bot = makeBot();
  const { ownerLinkCode } = importTs("@/lib/server/bot/secrets");
  const code = ownerLinkCode(bot.id, bot.telegram.botId, bot.telegram.connectedAt);
  const { flow, calls } = loadFlow();
  const ok = await flow.planTelegramMessage(bot, msg(`/start owner_${code}`));
  assert.equal(ok.kind, "send");
  assert.match(ok.text, /уведомления/);
  assert.deepEqual(calls.ownerChat, [42]);
  const bad = await flow.planTelegramMessage(bot, msg("/start owner_AAAAAAAAAAAAAAAAAAAAAAAA"));
  assert.match(bad.text, /устарела/);
  assert.deepEqual(calls.ownerChat, [42]);
});

test("Telegram: группы, боты и не-текст", async () => {
  const { flow, calls } = loadFlow();
  assert.deepEqual(await flow.planTelegramMessage(makeBot(), msg("hi", { chatType: "group" })), { kind: "ignore" });
  assert.deepEqual(await flow.planTelegramMessage(makeBot(), msg("hi", { fromIsBot: true })), { kind: "ignore" });
  assert.deepEqual(await flow.planTelegramMessage(makeBot(), msg(null)), { kind: "send", text: "Я пока понимаю только текст." });
  assert.equal(calls.accepted.length, 0);
});

test("Telegram: обычное сообщение уходит в мозг с ключом update_id и хешем чата", async () => {
  const { flow, calls } = loadFlow();
  const plan = await flow.planTelegramMessage(makeBot(), msg("/signup"));
  assert.equal(plan.kind, "reply");
  const input = calls.accepted[0];
  assert.equal(input.text, "Хочу оставить заявку.");
  assert.equal(input.chargeKey, `tg:${BOT_ID}:5`);
  assert.equal(input.telegramUpdateId, 5);
  assert.match(input.conversationId, /^tg:[A-Za-z0-9_-]{32}$/);
  assert.ok(!input.conversationId.includes("42"));
  assert.match(input.senderHash, /^[0-9a-f]{64}$/);
});

test("Telegram: бот на паузе — короткий ответ гостю без модели", async () => {
  const flow = importTsWith("@/lib/server/bot/telegram-flow", {
    "@/lib/server/audit": { audit: async () => undefined },
    "@/lib/server/bot/brain": {
      acceptMessage: async () => ({ status: "paused", text: "Бот сейчас на паузе и не отвечает. Загляните чуть позже!" }),
      completeMessage: async () => {
        throw new Error("модель не должна вызываться");
      },
    },
  });
  assert.deepEqual(await flow.planTelegramMessage(makeBot({ paused: true }), msg("Привет")), {
    kind: "send",
    text: "Бот сейчас на паузе и не отвечает. Загляните чуть позже!",
  });
});

// ---------- «Новый диалог» на публичной странице ----------

function loadWebRoute() {
  const calls = { cookies: [], messages: [] };
  const route = importTsWith("@/app/api/b/[slug]/route", {
    "next/server": {
      NextResponse: {
        json: (body, init) => {
          const response = new Response(JSON.stringify(body), init);
          response.cookies = { set: (name, value, options) => calls.cookies.push({ name, value, options }) };
          return response;
        },
      },
    },
    "@/lib/server/bot/brain": {
      handleMessage: async (input) => {
        calls.messages.push(input);
        return { status: "ok", text: "ответ", stars: 1, lead: null, card: null };
      },
    },
    "@/lib/server/bot/card": { startCard: async () => ({ ok: false, error: "card_unavailable" }) },
    "@/lib/server/bot/store": (loadReal) => ({
      ...loadReal("@/lib/server/bot/store"),
      loadBotBySlug: async () => ({ ...makeBot(), slug: "fira" }),
    }),
  });
  return { route, calls };
}

function webRequest(body, sid, origin = "https://example.com") {
  const req = new Request("https://example.com/api/b/fira", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "example.com" },
    body: JSON.stringify(body),
  });
  req.cookies = { get: (name) => (name === "iis_bot_sid" && sid ? { value: sid } : undefined) };
  return req;
}

const webCtx = { params: Promise.resolve({ slug: "fira" }) };
const SID = "AAAAAAAAAAAAAAAAAAAAAAAA";

test("веб-чат: «Новый диалог» выдаёт новую сессию, следующее сообщение — в новом диалоге", async () => {
  const { route, calls } = loadWebRoute();
  const reset = await route.POST(webRequest({ type: "reset" }, SID), webCtx);
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { ok: true });
  assert.equal(calls.cookies.length, 1);
  const fresh = calls.cookies[0];
  assert.equal(fresh.name, "iis_bot_sid");
  assert.match(fresh.value, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(fresh.value, SID);
  assert.equal(fresh.options.httpOnly, true);
  assert.equal(calls.messages.length, 0, "сброс не вызывает мозг и не тратит лимит");

  await route.POST(webRequest({ type: "message", text: "Привет", messageId: crypto.randomUUID() }, fresh.value), webCtx);
  assert.equal(calls.messages[0].conversationId, `web:${fresh.value}`);
  // хеш IP — отдельно от диалога (потолок сети)
  assert.match(calls.messages[0].senderHash, /^[0-9a-f]{64}$/);
});

test("веб-чат: «Новый диалог» с чужого сайта — 403", async () => {
  const { route, calls } = loadWebRoute();
  assert.equal((await route.POST(webRequest({ type: "reset" }, SID, "https://evil.example"), webCtx)).status, 403);
  assert.equal(calls.cookies.length, 0);
});

// ---------- Origin и билет открытки ----------

test("Origin: свой сайт — да, чужой, пустой и cross-site — нет", () => {
  const { isSameOrigin } = importTs("@/lib/server/bot/http");
  const req = (headers) => new Request("https://example.com/api/b/fira", { method: "POST", headers });
  assert.equal(isSameOrigin(req({ origin: "https://example.com", host: "example.com" })), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "example.com" })), false);
  assert.equal(isSameOrigin(req({ host: "example.com" })), false);
  assert.equal(isSameOrigin(req({ origin: "null", host: "example.com" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://example.com", host: "example.com", "sec-fetch-site": "cross-site" })), false);
});

test("билет открытки: только этот бот, этот диалог и до истечения", () => {
  const { signCardTicket, verifyCardTicket } = importTs("@/lib/server/bot/secrets");
  const now = Date.parse("2026-11-02T10:00:00Z");
  const ticket = signCardTicket({ botId: "b1", conversationId: "web:s1", scene: "Фира на сковородке" }, now);
  assert.equal(verifyCardTicket(ticket, { botId: "b1", conversationId: "web:s1" }, now + 1000), "Фира на сковородке");
  assert.equal(verifyCardTicket(ticket, { botId: "b2", conversationId: "web:s1" }, now), null);
  assert.equal(verifyCardTicket(ticket, { botId: "b1", conversationId: "web:s2" }, now), null);
  assert.equal(verifyCardTicket(ticket, { botId: "b1", conversationId: "web:s1" }, now + 31 * 60_000), null);
  const [body, mac] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ b: "b1", c: "web:s1", s: "другая сцена", e: now + 60_000 })).toString("base64url");
  assert.equal(verifyCardTicket(`${forged}.${mac}`, { botId: "b1", conversationId: "web:s1" }, now), null);
  assert.equal(verifyCardTicket(`${body}.`, { botId: "b1", conversationId: "web:s1" }, now), null);
});

// ---------- аудит № 49: доставка ответа в Telegram ----------

function loadReply({ typing = { ok: true, result: true }, sends = [{ ok: true, result: {} }], brainResult } = {}) {
  const calls = { sent: [], audits: [], brain: 0 };
  const queue = [...sends];
  const flow = importTsWith("@/lib/server/bot/telegram-flow", {
    "@/lib/server/audit": { audit: async (entry) => calls.audits.push(entry) },
    "@/lib/server/bot/brain": {
      acceptMessage: async () => ({ status: "accepted", messageId: 9 }),
      completeMessage: async () => {
        calls.brain++;
        return brainResult ?? { status: "ok", text: "ответ", stars: 1, lead: null, card: null };
      },
    },
    "@/lib/server/bot/telegram": (loadReal) => ({
      ...loadReal("@/lib/server/bot/telegram"),
      sendTyping: async () => typing,
      sendMessage: async (_token, chatId, text, timeoutMs) => {
        calls.sent.push({ chatId, text, timeoutMs });
        return queue.shift() ?? { ok: true, result: {} };
      },
    }),
  });
  return { flow, calls };
}

const replyInput = { conversationId: "tg:abc", chargeKey: `tg:${BOT_ID}:5` };

test("Telegram-ответ: доставлен с первого раза — без повтора и без записи в аудит", async () => {
  const { flow, calls } = loadReply();
  await flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.audits.length, 0);
});

test("Telegram-ответ: сбой сети — один повтор с коротким таймаутом", async () => {
  const { flow, calls } = loadReply({ sends: [{ ok: false, error: "network" }, { ok: true, result: {} }] });
  await flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(calls.sent.length, 2);
  assert.equal(calls.sent[1].timeoutMs, 4_000);
  assert.equal(calls.audits.length, 0);
});

test("Telegram-ответ: не доставлен и после повтора — запись в аудит с ключом списания", async () => {
  const { flow, calls } = loadReply({ sends: [{ ok: false, error: "timeout" }, { ok: false, error: "server", status: 502 }] });
  await flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(calls.sent.length, 2);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "bot.telegram_send_failed");
  assert.deepEqual(calls.audits[0].meta, { bot: BOT_ID, conversation: "tg:abc", chargeKey: `tg:${BOT_ID}:5`, stars: 1, error: "server" });
  assert.ok(!JSON.stringify(calls.audits[0]).includes("42"), "chat id в аудит не пишем");
});

test("Telegram-ответ: отказ Telegram (bad_request) и поздний сбой — без повтора", async () => {
  const bad = loadReply({ sends: [{ ok: false, error: "bad_request", status: 400 }] });
  await bad.flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(bad.calls.sent.length, 1);
  assert.equal(bad.calls.audits.length, 1);

  // с начала ответа прошло 50 с: повтор не уложится в maxDuration
  let t = 0;
  const late = loadReply({ sends: [{ ok: false, error: "timeout" }], brainResult: { status: "ok", text: "x", stars: 1, lead: null, card: null } });
  const now = () => (t += 50_000);
  await late.flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0, now });
  assert.equal(late.calls.sent.length, 1);
  assert.equal(late.calls.audits.length, 1);
});

test("Telegram-ответ: токен отозван — модель не зовём, звёзды не тратим", async () => {
  const { flow, calls } = loadReply({ typing: { ok: false, error: "unauthorized", status: 401 } });
  await flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(calls.brain, 0);
  assert.equal(calls.sent.length, 0);
});

test("Telegram-ответ: служебный ответ (бот отдыхает) не доставлен — без записи в аудит", async () => {
  const { flow, calls } = loadReply({
    sends: [{ ok: false, error: "network" }, { ok: false, error: "network" }],
    brainResult: { status: "resting", text: "Бот отдыхает и скоро вернётся." },
  });
  await flow.runTelegramReply(makeBot(), 42, replyInput, 9, { retryDelayMs: 0 });
  assert.equal(calls.sent.length, 2);
  assert.equal(calls.audits.length, 0);
});
