import "server-only";
import type { TaskStatusResult } from "@/lib/server/gateway";
import type { JobAction, JobStatus } from "@/lib/server/supabase/types";

/*
  Правила жизни задачи генерации без cron (Vercel Hobby). Их применяет GET /api/jobs/[id]
  при каждом опросе; описание правил — docs/platform/spec.md, §3, «Зависшие задачи».
  Модуль без ввода-вывода: только время и ответ шлюза → решение.
*/

const MINUTE = 60_000;

export const GATEWAY_POLL_INTERVAL_SEC = 5;
export const QUEUED_WITHOUT_TASK_LIMIT_MS = 3 * MINUTE;
export const STORING_RECLAIM_AFTER_MS = 3 * MINUTE; // как в SQL begin_job_storing
export const SUBMITTED_HARD_LIMIT_MS = 60 * MINUTE;
export const MAX_RESULT_FILES = 5;

const SLOW_ACTIONS: readonly JobAction[] = ["video", "motion", "lipsync"];

export function submittedTimeoutMs(action: JobAction): number {
  return SLOW_ACTIONS.includes(action) ? 15 * MINUTE : 5 * MINUTE;
}

export type JobTiming = {
  action: JobAction;
  status: JobStatus;
  gatewayTaskId: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
};

const since = (iso: string | null, now: number) => (iso ? now - Date.parse(iso) : 0);
const submittedFor = (job: JobTiming, now: number) => since(job.submittedAt ?? job.createdAt, now);

export function isQueuedWithoutTaskTooLong(job: JobTiming, now: number): boolean {
  return job.status === "queued" && !job.gatewayTaskId && since(job.createdAt, now) > QUEUED_WITHOUT_TASK_LIMIT_MS;
}

export function isPastSubmittedTimeout(job: JobTiming, now: number): boolean {
  return submittedFor(job, now) > submittedTimeoutMs(job.action);
}

export function isPastHardLimit(job: JobTiming, now: number): boolean {
  return submittedFor(job, now) > SUBMITTED_HARD_LIMIT_MS;
}

export function isStoringStale(job: JobTiming, now: number): boolean {
  return job.status === "storing" && since(job.updatedAt, now) > STORING_RECLAIM_AFTER_MS;
}

// ---------- ошибки задачи ----------
// В jobs.error пишем «код: подробности». Наружу уходит только код.

export const JOB_ERROR_CODES = ["generation_failed", "timeout", "gateway_lost", "gateway_error", "result_unavailable"] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

export function refundReason(code: JobErrorCode, detail?: string | null): string {
  const text = detail ? `${code}: ${detail}` : code;
  return text.slice(0, 500);
}

export function jobErrorCode(error: string | null): JobErrorCode | null {
  if (!error) return null;
  const code = error.split(":")[0].trim();
  return (JOB_ERROR_CODES as readonly string[]).includes(code) ? (code as JobErrorCode) : "generation_failed";
}

// ---------- ответ шлюза → следующий шаг ----------

export type GatewayDecision =
  | { next: "store"; urls: string[]; credits: number | null }
  | { next: "refund"; reason: string }
  | { next: "wait" };

export function resultUrlsToStore(status: Extract<TaskStatusResult, { ok: true }>): string[] {
  const urls = [...status.urls.slice(0, MAX_RESULT_FILES), ...(status.lastFrame ? [status.lastFrame] : [])];
  return [...new Set(urls)].slice(0, MAX_RESULT_FILES);
}

export function decideFromGatewayStatus(job: JobTiming, status: TaskStatusResult, now: number): GatewayDecision {
  if (!status.ok) {
    return isPastSubmittedTimeout(job, now)
      ? { next: "refund", reason: refundReason("generation_failed", `gateway: ${status.error}`) }
      : { next: "wait" };
  }
  if (status.state === "success") {
    const urls = resultUrlsToStore(status);
    return urls.length
      ? { next: "store", urls, credits: status.credits }
      : { next: "refund", reason: refundReason("result_unavailable", "no result urls") };
  }
  if (status.state === "fail" || status.done) {
    return { next: "refund", reason: refundReason("generation_failed", status.error ?? status.state) };
  }
  return isPastHardLimit(job, now) ? { next: "refund", reason: refundReason("timeout") } : { next: "wait" };
}
