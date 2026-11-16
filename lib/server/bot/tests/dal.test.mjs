import assert from "node:assert/strict";
import { importTsWith, test } from "./harness.mjs";

/*
  Данные страниц бота (lib/server/bot/dal.ts) и открытка (lib/server/bot/card.ts) на подменах:
  база — фейковый клиент Supabase, который запоминает запросы.
    № 39 — счётчики «Боты группы» одним вызовом group_bot_counters;
    № 40 — «Заявки»: последние 500 и общее число, CSV — все заявки страницами;
    № 45 — открытка гостю идёт через create_bot_card_job с лимитами;
    подписи ссылок — через общий кеш (signMediaPaths), шлюзу — свежая.
*/

process.env.BOT_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

/** Фейковый клиент: from(table) → цепочка; результат — handlers[table](запрос). */
function fakeDb(handlers = {}, rpcs = {}) {
  const log = { from: [], rpc: [] };
  const client = {
    from(table) {
      const query = { table, filters: [], order: [], range: null, select: null, options: null };
      log.from.push(query);
      const builder = {
        select(columns, options) {
          query.select = columns;
          query.options = options ?? null;
          return builder;
        },
        eq(column, value) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        in(column, value) {
          query.filters.push(["in", column, value]);
          return builder;
        },
        is: () => builder,
        not: () => builder,
        gte: () => builder,
        order(column, options) {
          query.order.push([column, options?.ascending ?? true]);
          return builder;
        },
        limit: () => builder,
        range(from, to) {
          query.range = [from, to];
          return builder;
        },
        maybeSingle: () => builder,
        then(resolve, reject) {
          return Promise.resolve((handlers[table] ?? (() => ({ data: [], error: null })))(query)).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      log.rpc.push({ name, args });
      return (rpcs[name] ?? (() => ({ data: [], error: null })))(args);
    },
  };
  return { client, log };
}

const teacher = { id: "t1", role: "teacher", group: null };
const owner = { id: "u1", role: "student", group: null };

function loadDal(db, { signed = [] } = {}) {
  return importTsWith("@/lib/server/bot/dal", {
    "@/lib/server/supabase/admin": { createAdminClient: () => db.client },
    "@/lib/server/dal/teacher": {
      getGroup: async (_user, id) => ({ id, code: "g1", title: "Группа", endsOn: null }),
    },
    "@/lib/server/bot/card": { avatarPath: async () => null, signedMediaUrl: async () => null },
    "@/lib/server/bot/brain": { cardsAvailable: () => false },
    "@/lib/server/prices": { canUse: async () => ({ ok: true, stars: 1 }) },
    "@/lib/server/storage": {
      signMediaPaths: async (paths, ttl, options) => {
        signed.push({ paths, ttl, options });
        return new Map(paths.map((p) => [p, `https://signed/${p}`]));
      },
    },
    "@/lib/server/bot/store": (loadReal) => ({
      ...loadReal("@/lib/server/bot/store"),
      loadBotByOwner: async () => ({ id: "bot-1", tools: { leadForm: { title: "Форма", fields: [] } } }),
    }),
  });
}

// ---------- № 39 ----------

test("Боты группы: счётчики всех ботов — один вызов group_bot_counters, без COUNT на каждого", async () => {
  const db = fakeDb(
    {
      profiles: () => ({
        data: [
          { id: "s1", login: "g1-ann", nickname: "Аня", age_band: "adult" },
          { id: "s2", login: "g1-bob", nickname: "Боря", age_band: "u16" },
        ],
        error: null,
      }),
      bots: () => ({
        data: [
          { id: "b1", owner_id: "s1", slug: "ann", name: "А", tools: {}, telegram_bot_username: null, telegram_token_ciphertext: null, updated_at: "" },
          { id: "b2", owner_id: "s2", slug: "bob", name: "Б", tools: {}, telegram_bot_username: null, telegram_token_ciphertext: null, updated_at: "" },
        ],
        error: null,
      }),
    },
    { group_bot_counters: () => ({ data: [{ bot_id: "b1", leads_count: 3, guest_messages: "12" }], error: null }) },
  );
  const result = await loadDal(db).listGroupBots(teacher, "grp");
  assert.equal(db.log.rpc.length, 1);
  assert.deepEqual(db.log.rpc[0].args.p_bot_ids, ["b1", "b2"]);
  assert.deepEqual(
    db.log.from.map((q) => q.table),
    ["profiles", "bots"],
    "заявки и сообщения не считаются по одному боту",
  );
  assert.deepEqual(
    result.bots.map((b) => [b.botId, b.leadsCount, b.guestMessagesWeek]),
    [
      ["b1", 3, 12],
      ["b2", 0, 0],
    ],
  );
});

test("Боты группы: ошибка счётчиков — ошибка страницы, а не молчаливый 0", async () => {
  const db = fakeDb(
    {
      profiles: () => ({ data: [{ id: "s1", login: "a", nickname: "А", age_band: "adult" }], error: null }),
      bots: () => ({
        data: [{ id: "b1", owner_id: "s1", slug: "a", name: "А", tools: {}, telegram_bot_username: null, telegram_token_ciphertext: null, updated_at: "" }],
        error: null,
      }),
    },
    { group_bot_counters: () => ({ data: null, error: { code: "57014" } }) },
  );
  await assert.rejects(loadDal(db).listGroupBots(teacher, "grp"), /counters failed \(57014\)/);
});

// ---------- № 40 ----------

const leadRow = (i) => ({ id: `l${i}`, channel: "web", created_at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString(), data: { Имя: `Гость ${i}` } });

test("Заявки: страница — последние 500 новые сверху и общее число", async () => {
  const db = fakeDb({ bot_leads: () => ({ data: [leadRow(2), leadRow(1)], error: null, count: 1700 }) });
  const result = await loadDal(db).listMyLeads(owner);
  const query = db.log.from[0];
  assert.deepEqual(query.range, [0, 499]);
  assert.deepEqual(query.options, { count: "exact" });
  assert.deepEqual(query.order, [
    ["created_at", false],
    ["id", false],
  ]);
  assert.equal(result.total, 1700);
  assert.deepEqual(
    result.leads.map((l) => l.id),
    ["l2", "l1"],
  );
});

test("Заявки: CSV — все заявки страницами (больше 1000), новые сверху", async () => {
  const all = Array.from({ length: 1500 }, (_, i) => leadRow(i));
  const db = fakeDb({ bot_leads: (q) => ({ data: all.slice(q.range[0], q.range[1] + 1), error: null }) });
  const result = await loadDal(db).listMyLeads(owner, { all: true });
  assert.equal(result.leads.length, 1500);
  assert.equal(result.total, 1500);
  assert.equal(result.leads[0].id, "l1499", "новые сверху");
  assert.equal(result.leads[1499].id, "l0");
  assert.deepEqual(db.log.from[0].order, [
    ["created_at", true],
    ["id", true],
  ]);
  assert.ok(db.log.from.length >= 2, "несколько страниц");
});

test("Аватар из галереи: свои картинки подписываются через общий кеш", async () => {
  const signed = [];
  const db = fakeDb({ jobs: () => ({ data: [{ id: "j1", prompt: "кот", storage_path: "u1/j1.png", created_at: "" }], error: null }) });
  const images = await loadDal(db, { signed }).listMyImages(owner);
  assert.deepEqual(images, [{ jobId: "j1", url: "https://signed/u1/j1.png", label: "кот" }]);
  assert.deepEqual(signed[0].paths, ["u1/j1.png"]);
  assert.equal(signed[0].options, undefined, "через кеш, не fresh");
});

// ---------- № 45: открытка ----------

function loadCard({ walletResult = { ok: true, jobId: "job-1", balance: 5, reused: false }, avatarJob = null } = {}) {
  const calls = { card: [], plain: [], signed: [], tasks: [] };
  const db = fakeDb({ jobs: () => ({ data: avatarJob, error: null }) });
  const card = importTsWith("@/lib/server/bot/card", {
    "@/lib/server/supabase/admin": { createAdminClient: () => db.client },
    "@/lib/server/bot/brain": { cardsAvailable: () => true },
    "@/lib/server/bot/secrets": { verifyCardTicket: () => "машет лапкой" },
    "@/lib/server/bot/store": { lifetimeOf: () => ({ retired: false }), priceSubject: (o) => o },
    "@/lib/server/prices": { canUse: async (_s, action) => ({ ok: true, action, model: action === "image" ? "flux-3/klein-text-to-image" : "flux-3/klein-edit-image", stars: 2 }) },
    "@/lib/server/gateway": {
      isGatewayModel: () => true,
      createTask: async (request) => {
        calls.tasks.push(request);
        return { ok: true, taskId: "task-1", state: "waiting" };
      },
      getTaskStatus: async () => ({ ok: true, done: false }),
      downloadResult: async () => ({ ok: false, error: "x" }),
    },
    "@/lib/server/jobs": {
      beginJobStoring: async () => false,
      claimJobPoll: async () => false,
      completeJob: async () => undefined,
      markJobSubmitted: async () => undefined,
      mediaPath: (u, j, e) => `${u}/${j}.${e}`,
    },
    "@/lib/server/storage": {
      SIGNED_URL_TTL_SEC: 3600,
      uploadMedia: async () => ({ ok: true }),
      signMediaPaths: async (paths, ttl, options) => {
        calls.signed.push({ paths, ttl, options });
        return new Map(paths.map((p) => [p, `https://signed/${p}`]));
      },
    },
    "@/lib/server/wallet": {
      createCardJobWithDebit: async (input) => {
        calls.card.push(input);
        return walletResult;
      },
      createJobWithDebit: async (input) => {
        calls.plain.push(input);
        return { ok: true, jobId: "job-p", balance: 5, reused: false };
      },
      refundJob: async () => ({ ok: true, refunded: 0, balance: 0 }),
    },
  });
  return { card, calls };
}

const cardBot = (extra = {}) => ({
  id: "b1",
  ownerId: "u1",
  name: "Фира",
  active: true,
  paused: false,
  avatarJobId: null,
  tools: { image: true },
  owner: { id: "u1", role: "student", ageBand: "adult" },
  ...extra,
});

test("Открытка гостю: лимиты 3 в сутки и 2 в работе — в SQL вместе со списанием", async () => {
  const { card, calls } = loadCard();
  const result = await card.startCard({ bot: cardBot(), conversationId: "web:s1", preview: false, ticket: "t" });
  assert.deepEqual(result, { ok: true, jobId: "job-1", stars: 2 });
  assert.equal(calls.card.length, 1);
  assert.equal(calls.plain.length, 0);
  assert.equal(calls.card[0].dailyLimit, 3);
  assert.equal(calls.card[0].activeLimit, 2);
  assert.equal(calls.card[0].taskRef, "bot-card:b1");
  assert.equal(calls.card[0].userId, "u1");
});

test("Открытка гостю: лимит и занятые места — понятные коды", async () => {
  const limit = loadCard({ walletResult: { ok: false, error: "card_limit" } });
  assert.deepEqual(await limit.card.startCard({ bot: cardBot(), conversationId: "web:s1", preview: false, ticket: "t" }), {
    ok: false,
    error: "card_limit",
  });
  const busy = loadCard({ walletResult: { ok: false, error: "too_many_jobs" } });
  assert.deepEqual(await busy.card.startCard({ bot: cardBot(), conversationId: "web:s1", preview: false, ticket: "t" }), {
    ok: false,
    error: "card_busy",
  });
});

test("Открытка в проверке владельцем — без лимитов (обычная create_job)", async () => {
  const { card, calls } = loadCard();
  await card.startCard({ bot: cardBot(), conversationId: "owner:u1", preview: true, ticket: "t" });
  assert.equal(calls.card.length, 0);
  assert.equal(calls.plain.length, 1);
  assert.equal(calls.plain[0].taskRef, "bot-card:b1");
});

test("Открытка с аватаром: шлюзу — свежая ссылка мимо кеша, после проверки, что картинка владельца", async () => {
  const avatarJob = { user_id: "u1", status: "done", action: "image", storage_path: "u1/a.png", hidden: false, deleted_at: null };
  const { card, calls } = loadCard({ avatarJob });
  await card.startCard({ bot: cardBot({ avatarJobId: "a" }), conversationId: "web:s1", preview: false, ticket: "t" });
  assert.deepEqual(calls.signed, [{ paths: ["u1/a.png"], ttl: 3600, options: { fresh: true } }]);
  assert.deepEqual(calls.tasks[0].images, ["https://signed/u1/a.png"]);

  // чужая картинка аватаром — не подписывается вовсе
  const foreign = loadCard({ avatarJob: { ...avatarJob, user_id: "other" } });
  await foreign.card.startCard({ bot: cardBot({ avatarJobId: "a" }), conversationId: "web:s1", preview: false, ticket: "t" });
  assert.equal(foreign.calls.signed.length, 0);
  assert.equal(foreign.calls.tasks[0].action, "image");
});

test("Готовая открытка гостю: ссылка из общего кеша (не fresh)", async () => {
  const db = fakeDb({
    jobs: () => ({
      data: { id: "j1", user_id: "u1", status: "done", storage_path: "u1/j1.png", params: { conversation: "web:s1" }, task_ref: "bot-card:b1" },
      error: null,
    }),
  });
  const signed = [];
  const card = importTsWith("@/lib/server/bot/card", {
    "@/lib/server/supabase/admin": { createAdminClient: () => db.client },
    "@/lib/server/bot/brain": { cardsAvailable: () => true },
    "@/lib/server/storage": {
      SIGNED_URL_TTL_SEC: 3600,
      uploadMedia: async () => ({ ok: true }),
      signMediaPaths: async (paths, ttl, options) => {
        signed.push({ paths, ttl, options });
        return new Map(paths.map((p) => [p, `https://signed/${p}`]));
      },
    },
  });
  assert.deepEqual(await card.pollCard({ id: "b1", ownerId: "u1" }, "j1", { conversationId: "web:s1" }), {
    status: "done",
    url: "https://signed/u1/j1.png",
  });
  assert.deepEqual(signed, [{ paths: ["u1/j1.png"], ttl: 3600, options: {} }]);
  // чужой диалог — ни ссылки, ни подписи
  assert.equal(await card.pollCard({ id: "b1", ownerId: "u1" }, "j1", { conversationId: "web:s2" }), null);
  assert.equal(signed.length, 1);
});
