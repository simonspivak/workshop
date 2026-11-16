import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Обход брошенных задач POST /api/jobs/sweep (аудит 2026-11-08, № 19) на подменах:
  доступ по CRON_SECRET, выборка задач, очередь с бюджетом времени. База и шлюз не трогаются.
*/

const SECRET = "s3cret-for-tests-only-0123456789";

/** Подменённый PostgREST-построитель: пишет фильтры, отдаёт rows. */
function fakeAdmin(rows) {
  const query = [];
  const builder = {
    select: (cols) => (query.push(["select", cols]), builder),
    in: (col, values) => (query.push(["in", col, values]), builder),
    neq: (col, value) => (query.push(["neq", col, value]), builder),
    lt: (col, value) => (query.push(["lt", col, value]), builder),
    or: (filter) => (query.push(["or", filter]), builder),
    order: (col, opts) => (query.push(["order", col, opts]), builder),
    limit: (n) => (query.push(["limit", n]), builder),
    returns: () => Promise.resolve({ data: rows, error: null }),
  };
  return { client: { from: (table) => (query.push(["from", table]), builder) }, query };
}

function loadSweep({ rows = [], advance } = {}) {
  const admin = fakeAdmin(rows);
  const advanced = [];
  const mocks = {
    "@/lib/server/supabase/admin": { createAdminClient: () => admin.client },
    "@/lib/server/job-progress": {
      JOB_COLUMNS: "id, status",
      advanceJob:
        advance ??
        (async (job, options) => {
          advanced.push({ id: job.id, deadline: options.deadline });
          return { ...job, status: job.next ?? job.status };
        }),
    },
  };
  const sweep = importTsWith("@/lib/server/job-sweep", mocks);
  const route = importTsWith("@/app/api/jobs/sweep/route", {
    ...mocks,
    "@/lib/server/env": { ConfigError: class ConfigError extends Error {} },
  });
  return { sweep, route, admin, advanced };
}

function request(authorization) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return { headers };
}

async function withSecret(value, fn) {
  const before = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  const info = console.info;
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.info = info;
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
}

// ---------- доступ ----------

test("sweep: нет CRON_SECRET — 404 (обход выключен), база не трогается", async () => {
  const { route, admin } = loadSweep({ rows: [{ id: "j1", status: "queued" }] });
  await withSecret(undefined, async () => {
    const post = await route.POST(request(`Bearer ${SECRET}`));
    assert.equal(post.status, 404);
    const get = await route.GET(request(`Bearer ${SECRET}`));
    assert.equal(get.status, 404);
  });
  await withSecret("short", async () => {
    assert.equal((await route.POST(request("Bearer short"))).status, 404, "короткий секрет = не настроено");
  });
  assert.deepEqual(admin.query, []);
});

test("sweep: без заголовка, с чужим секретом или без Bearer — 401, база не трогается", async () => {
  const { route, admin } = loadSweep({ rows: [{ id: "j1", status: "queued" }] });
  await withSecret(SECRET, async () => {
    for (const header of [undefined, "", "Bearer ", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`]) {
      const response = await route.POST(request(header));
      assert.equal(response.status, 401, `заголовок ${JSON.stringify(header)}`);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
  });
  assert.deepEqual(admin.query, []);
});

test("sweep: верный секрет (POST и GET от Vercel Cron) — 200 и счётчики без данных задач", async () => {
  const rows = [
    { id: "j1", status: "queued", next: "failed" },
    { id: "j2", status: "submitted", next: "storing" },
    { id: "j3", status: "submitted" },
  ];
  const { route, advanced } = loadSweep({ rows });
  await withSecret(SECRET, async () => {
    const response = await route.POST(request(`Bearer ${SECRET}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await response.json(), { ok: true, checked: 3, done: 0, failed: 1, storing: 1, unchanged: 1, errors: 0, skipped: 0 });
    assert.equal((await route.GET(request(`Bearer ${SECRET}`))).status, 200);
  });
  assert.deepEqual(advanced.map((a) => a.id), ["j1", "j2", "j3", "j1", "j2", "j3"]);
});

test("checkSweepAccess: сравнение за постоянное время не зависит от длины ввода", async () => {
  const { sweep } = loadSweep();
  assert.equal(sweep.checkSweepAccess(`Bearer ${SECRET}`, SECRET), "ok");
  assert.equal(sweep.checkSweepAccess(`Bearer ${"x".repeat(5000)}`, SECRET), "unauthorized");
  assert.equal(sweep.checkSweepAccess(null, SECRET), "unauthorized");
  assert.equal(sweep.checkSweepAccess(`Bearer ${SECRET}`, undefined), "disabled");
  assert.equal(sweep.checkSweepAccess(`Bearer ${SECRET}`, ""), "disabled");
});

// ---------- выборка и очередь ----------

test("loadIdleJobs: самые старые незавершённые, кроме монтажа, не опрошенные больше минуты, до 10", async () => {
  const { sweep, admin } = loadSweep({ rows: [] });
  const now = Date.parse("2026-11-16T04:23:00.000Z");
  await sweep.loadIdleJobs(now);
  const cutoff = "2026-11-16T04:22:00.000Z";
  assert.deepEqual(admin.query, [
    ["from", "jobs"],
    ["select", "id, status"],
    ["in", "status", ["queued", "submitted", "storing"]],
    ["neq", "action", "montage"],
    ["lt", "created_at", cutoff],
    ["or", `last_polled_at.is.null,last_polled_at.lt."${cutoff}"`],
    ["order", "created_at", { ascending: true }],
    ["limit", 10],
  ]);
  assert.equal(sweep.SWEEP_BATCH, 10);
  assert.equal(sweep.SWEEP_IDLE_SEC, 60);
});

test("sweepJobs: срок копирования — 55 с от начала запроса; после 40 с новые задачи не берём", async () => {
  let clock = 1_000_000;
  const seen = [];
  const { sweep } = loadSweep();
  const jobs = [1, 2, 3, 4].map((n) => ({ id: `j${n}`, status: "submitted" }));
  const summary = await sweep.sweepJobs(1_000_000, {
    load: async () => jobs,
    now: () => clock,
    advance: async (job, options) => {
      seen.push({ id: job.id, deadline: options.deadline });
      clock += 15_000; // каждый опрос шлюза — 15 с (худший случай)
      return job;
    },
  });
  assert.deepEqual(seen.map((s) => s.id), ["j1", "j2", "j3"]);
  assert.ok(seen.every((s) => s.deadline === 1_055_000));
  assert.deepEqual(summary, { checked: 3, done: 0, failed: 0, storing: 0, unchanged: 3, errors: 0, skipped: 1 });
});

test("sweepJobs: ошибка одной задачи не останавливает обход", async () => {
  const { sweep } = loadSweep();
  const original = console.error;
  console.error = () => {};
  try {
    const summary = await sweep.sweepJobs(Date.now(), {
      load: async () => [{ id: "a", status: "queued" }, { id: "b", status: "queued" }],
      advance: async (job) => {
        if (job.id === "a") throw new Error("db down");
        return { ...job, status: "failed" };
      },
    });
    assert.deepEqual(summary, { checked: 2, done: 0, failed: 1, storing: 0, unchanged: 0, errors: 1, skipped: 0 });
  } finally {
    console.error = original;
  }
});
