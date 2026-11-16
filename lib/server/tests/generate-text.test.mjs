import assert from "node:assert/strict";
import { importTsWith, test } from "../bot/tests/harness.mjs";

/*
  Синхронный текст (lib/server/generate.ts runText) после списания: каждый выход либо завершает
  задачу, либо возвращает звёзды (аудит 2026-11-08, № 16). Шлюз, база и Next.js подменены.
*/

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const USER = { id: "u1", role: "student", group: { id: "g1", shareGallery: false }, ageBand: "u16", parentalConsent: false };

function loadGenerate({ generateText, completeJob, refundJob, loadJob } = {}) {
  const calls = { refund: [], complete: [] };
  const mod = importTsWith("@/lib/server/generate", {
    "next/server": { after: () => {} },
    "@/lib/server/audit": { audit: async () => {} },
    "@/lib/server/course": { getLessonById: () => null, lessonHasTask: () => false },
    "@/lib/server/dal/auth": { isStaff: (user) => user.role !== "student" },
    "@/lib/server/env": { appUrl: () => null },
    "@/lib/server/gateway": {
      createTask: async () => assert.fail("createTask не ждали"),
      generateText: generateText ?? (async () => ({ ok: true, text: "ответ", credits: 1 })),
      isAccountFailure: () => false,
      isGatewayModel: () => true,
      isPermanentFailure: () => false,
    },
    "@/lib/server/job-progress": {
      loadJob: loadJob ?? (async (id) => ({ id, status: "done", action: "text" })),
      toJobView: async (job) => ({ id: job.id, status: job.status }),
    },
    "@/lib/server/jobs": {
      completeJob: async (...args) => {
        calls.complete.push(args);
        return completeJob ? completeJob(...args) : true;
      },
      markJobSubmitted: async () => true,
    },
    "@/lib/server/moderation": { moderateFields: () => ({ ok: true }) },
    "@/lib/server/prices": { canUse: async () => ({ ok: true, model: "claude-haiku-5-5", stars: 1 }), LONG_TEXT_TOKENS: 800 },
    "@/lib/server/storage": {
      resolveReferences: async () => ({ ok: true, refs: { urls: {}, stored: {} } }),
      checkStudentLipsyncAudio: async () => true,
    },
    "@/lib/server/wallet": {
      createJobWithDebit: async () => ({ ok: true, jobId: JOB_ID, balance: 99, reused: false }),
      refundJob: async (...args) => {
        calls.refund.push(args);
        return refundJob ? refundJob(...args) : { ok: true, refunded: 1, balance: 100 };
      },
    },
  });
  const input = mod.generateRequestSchema.parse({ action: "text", prompt: "привет", idempotencyKey: "key-text-0001" });
  return { run: () => mod.startGeneration(USER, input), calls };
}

async function quiet(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

test("текст: ответ модели записан — задача завершена, возврата нет", async () => {
  const { run, calls } = loadGenerate();
  const outcome = await run();
  assert.equal(outcome.kind, "text");
  assert.equal(calls.complete.length, 1);
  assert.deepEqual(calls.refund, []);
});

test("текст: complete_job упал после ответа модели — звёзды возвращаются, ответ с jobId", async () => {
  const { run, calls } = loadGenerate({ completeJob: async () => Promise.reject(new Error("jobs.completeJob failed")) });
  const { result } = await quiet(run);
  assert.deepEqual(result, { kind: "error", status: 500, error: "server_error", jobId: JOB_ID });
  assert.equal(calls.refund.length, 1);
  assert.equal(calls.refund[0][0], JOB_ID);
  assert.equal(calls.refund[0][1], "gateway_error: complete failed");
});

test("текст: и complete_job, и возврат упали — ответ всё равно с jobId, не исключение", async () => {
  const { run, calls } = loadGenerate({
    completeJob: async () => Promise.reject(new Error("db down")),
    refundJob: async () => Promise.reject(new Error("db down")),
  });
  const { result, logged } = await quiet(run);
  assert.equal(result.kind, "error");
  assert.equal(result.jobId, JOB_ID);
  assert.equal(calls.refund.length, 1);
  assert.ok(logged.some(([message]) => message === "generate: refund threw"));
});

test("текст: шлюз отказал, а возврат не прошёл (ok: false) — это видно в логах", async () => {
  const { run, calls } = loadGenerate({
    generateText: async () => ({ ok: false, error: "gateway_unreachable", httpStatus: 502 }),
    refundJob: async () => ({ ok: false, error: "server_error" }),
  });
  const { result, logged } = await quiet(run);
  assert.deepEqual(result, { kind: "error", status: 502, error: "gateway_error", jobId: JOB_ID });
  assert.equal(calls.refund.length, 1);
  assert.ok(logged.some(([message]) => message === "generate: refund failed"));
});

test("текст: вызов шлюза бросил исключение — звёзды возвращаются до ответа 500", async () => {
  const { run, calls } = loadGenerate({ generateText: async () => Promise.reject(new Error("boom")) });
  await quiet(async () => assert.rejects(run(), /boom/));
  assert.equal(calls.refund.length, 1);
  assert.equal(calls.refund[0][1], "gateway_error: text call threw");
  assert.deepEqual(calls.complete, []);
});
