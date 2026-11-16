import type { NextRequest } from "next/server";
import { ConfigError } from "@/lib/server/env";
import { checkSweepAccess, sweepJobs } from "@/lib/server/job-sweep";
import { sweepBotGuestData, type RetentionSummary } from "@/lib/server/retention";

/*
  POST /api/jobs/sweep — обход брошенных задач генерации (lib/server/job-sweep.ts, аудит № 19).
  Только с Authorization: Bearer <CRON_SECRET>. Без переменной CRON_SECRET — 404 (обход выключен).
  Vercel Cron (vercel.json, раз в сутки — предел Hobby) вызывает путь методом GET с тем же
  заголовком, поэтому GET делает то же самое.
  Тот же вызов чистит гостевые данные ботов по срокам хранения (lib/server/retention.ts, аудит № 23):
  до обхода задач, одним SQL-вызовом с пределом строк; её сбой обход задач не останавливает.
  Ответ — только счётчики, без данных задач и гостей.
*/

// задачи идут по очереди, копирование результатов — в after() и укладывается в эту минуту
export const maxDuration = 60;

async function handle(request: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const access = checkSweepAccess(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (access === "disabled") return json({ error: "not_found" }, 404);
  if (access === "unauthorized") return json({ error: "unauthorized" }, 401);
  try {
    const retention = await sweepRetention();
    const summary = await sweepJobs(startedAt);
    console.info("api.jobs.sweep: done", { ...summary, ...retention });
    return json({ ok: true, ...summary, ...retention }, 200);
  } catch (error) {
    if (error instanceof ConfigError) return json({ error: "not_configured" }, 503);
    console.error("api.jobs.sweep: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "server_error" }, 500);
  }
}

/** Сроки хранения: null в счётчиках — чистка не прошла (ошибка в логе), обход задач идёт дальше. */
async function sweepRetention(): Promise<RetentionSummary | { botMessages: null; botLeads: null }> {
  try {
    return await sweepBotGuestData();
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    console.error("api.jobs.sweep: retention failed", { error: error instanceof Error ? error.message : String(error) });
    return { botMessages: null, botLeads: null };
  }
}

export const POST = handle;
export const GET = handle;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private" } });
}
