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

function makeBot({ endsOn = null, ageBand = "adult", active = true } = {}) {
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

test("Telegram: /start — приветствие из души, без модели и звёзд", async () => {
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
