import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { advanceJob, JOB_COLUMNS, type JobRecord } from "@/lib/server/job-progress";
import { JOB_REQUEST_BUDGET_MS } from "@/lib/server/job-rules";
import { createAdminClient } from "@/lib/server/supabase/admin";

/*
  Обход брошенных задач (аудит № 19). Задачу продвигает только опрос GET /api/jobs/[id];
  если её никто не открывает (вкладка закрыта, ученик ушёл), она висит, а звёзды заморожены.
  POST /api/jobs/sweep (Vercel Cron раз в сутки, vercel.json) берёт самые старые незавершённые
  задачи, которые никто не опрашивал больше минуты, и прогоняет их через тот же advanceJob:
  готовое копируется в галерею, неудачное и зависшее — возврат звёзд по job-rules.ts.
  Монтаж не трогаем: его ведёт студия (загрузка из браузера).

  Доступ — только с заголовком Authorization: Bearer <CRON_SECRET> (Vercel Cron присылает его сам).
  Пока переменной CRON_SECRET нет, маршрут отвечает 404 — обход выключен.
*/

/** Сколько задач за один вызов (самые старые первыми). */
export const SWEEP_BATCH = 10;
/** Задачу, которую опрашивали недавно, ведёт браузер — не трогаем. */
export const SWEEP_IDLE_SEC = 60;
/** Новые задачи берём, пока от начала вызова прошло меньше этого: остальное время — на копирование в after(). */
export const SWEEP_PICK_BUDGET_MS = 40_000;
/** Короткий секрет считаем ошибкой настройки: обход выключен. */
export const MIN_CRON_SECRET_LENGTH = 16;

export type SweepAccess = "disabled" | "unauthorized" | "ok";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Проверка заголовка Authorization за постоянное время (сравниваются sha256, длины равны). */
export function checkSweepAccess(authorization: string | null, secret: string | undefined): SweepAccess {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return "disabled";
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  const given = match ? match[1] : "";
  const ok = timingSafeEqual(digest(given), digest(secret));
  return ok && given.length > 0 ? "ok" : "unauthorized";
}

export type SweepSummary = {
  checked: number;
  done: number;
  failed: number;
  storing: number;
  errors: number;
  /** ещё ждут шлюз (или опрос был недавно) */
  unchanged: number;
  /** не успели за SWEEP_PICK_BUDGET_MS — достанутся следующему вызову */
  skipped: number;
};

/** Самые старые незавершённые задачи (кроме монтажа), которые не опрашивали дольше SWEEP_IDLE_SEC. */
export async function loadIdleJobs(now: number, limit = SWEEP_BATCH): Promise<JobRecord[]> {
  const cutoff = new Date(now - SWEEP_IDLE_SEC * 1000).toISOString();
  const { data, error } = await createAdminClient()
    .from("jobs")
    .select(JOB_COLUMNS)
    .in("status", ["queued", "submitted", "storing"])
    .neq("action", "montage")
    .lt("created_at", cutoff)
    .or(`last_polled_at.is.null,last_polled_at.lt."${cutoff}"`)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<JobRecord[]>();
  if (error) throw new Error(`jobSweep.loadIdleJobs failed (${error.code})`);
  return data ?? [];
}

/**
 * Продвинуть брошенные задачи по очереди. startedAt — начало запроса: копирование результатов
 * (after()) обрывается к startedAt + JOB_REQUEST_BUDGET_MS, новые задачи не берём после SWEEP_PICK_BUDGET_MS.
 */
export async function sweepJobs(
  startedAt: number,
  deps: { load?: typeof loadIdleJobs; advance?: typeof advanceJob; now?: () => number } = {},
): Promise<SweepSummary> {
  const load = deps.load ?? loadIdleJobs;
  const advance = deps.advance ?? advanceJob;
  const now = deps.now ?? Date.now;
  const deadline = startedAt + JOB_REQUEST_BUDGET_MS;
  const jobs = await load(startedAt);
  const summary: SweepSummary = { checked: 0, done: 0, failed: 0, storing: 0, unchanged: 0, errors: 0, skipped: 0 };

  for (const job of jobs) {
    if (now() - startedAt > SWEEP_PICK_BUDGET_MS) {
      summary.skipped++;
      continue;
    }
    summary.checked++;
    try {
      const next = await advance(job, { deadline });
      // storing — копирование идёт в after() или его уже ведёт другой запрос
      if (next.status === "done") summary.done++;
      else if (next.status === "failed") summary.failed++;
      else if (next.status === "storing") summary.storing++;
      else summary.unchanged++;
    } catch (error) {
      summary.errors++;
      console.error("jobSweep: advance failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}
