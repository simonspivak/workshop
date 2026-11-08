import "server-only";
import { after } from "next/server";
import { isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { isUuid } from "@/lib/server/dal/teacher";
import { downloadResult, getTaskStatus } from "@/lib/server/gateway";
import {
  GATEWAY_POLL_INTERVAL_SEC,
  decideFromGatewayStatus,
  isPastHardLimit,
  isQueuedWithoutTaskTooLong,
  isStoringStale,
  jobErrorCode,
  refundReason,
  type GatewayDecision,
  type JobTiming,
} from "@/lib/server/job-rules";
import { beginJobStoring, claimJobPoll, completeJob, mediaPath } from "@/lib/server/jobs";
import { mediaKindOfPath } from "@/lib/server/media-refs";
import { signMediaPaths, uploadMedia } from "@/lib/server/storage";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Database } from "@/lib/server/supabase/types";
import { refundJob } from "@/lib/server/wallet";
import type { JobView, MediaFile } from "@/lib/platform/generation-types";

/*
  Ленивый опрос задач (cron нет): GET /api/jobs/[id] вызывает advanceJob, тот по правилам из
  job-rules.ts спрашивает шлюз (не чаще раза в 5 секунд на задачу), копирует готовый файл
  в Storage или возвращает звёзды. Копирование идёт в after(): ответ опроса не ждёт скачивания.
*/

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export const JOB_COLUMNS =
  "id, user_id, group_id, action, model, status, stars, prompt, result_text, storage_path, extra_paths, " +
  "mime_type, error, hidden, deleted_at, gateway_task_id, lesson_id, task_ref, created_at, updated_at, submitted_at, completed_at";

export type JobRecord = Pick<
  JobRow,
  | "id"
  | "user_id"
  | "group_id"
  | "action"
  | "model"
  | "status"
  | "stars"
  | "prompt"
  | "result_text"
  | "storage_path"
  | "extra_paths"
  | "mime_type"
  | "error"
  | "hidden"
  | "deleted_at"
  | "gateway_task_id"
  | "lesson_id"
  | "task_ref"
  | "created_at"
  | "updated_at"
  | "submitted_at"
  | "completed_at"
>;

export async function loadJob(jobId: string): Promise<JobRecord | null> {
  if (!isUuid(jobId)) return null;
  const { data, error } = await createAdminClient()
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle<JobRecord>();
  if (error) throw new Error(`jobProgress.loadJob failed (${error.code})`);
  return data;
}

/** Владелец задачи или ведущий её группы (админ — любой). */
export async function canViewJob(user: SessionUser, job: Pick<JobRecord, "user_id" | "group_id">): Promise<boolean> {
  if (job.user_id === user.id) return true;
  if (!isStaff(user)) return false;
  if (user.role === "admin") return true;
  if (!job.group_id) return false;
  const { data, error } = await createAdminClient()
    .from("groups")
    .select("id")
    .eq("id", job.group_id)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`jobProgress.canViewJob failed (${error.code})`);
  return Boolean(data);
}

/** Задача, если пользователь может её видеть. null — нет такой или чужая (наружу — одинаково 404). */
export async function loadJobForViewer(user: SessionUser, jobId: string): Promise<JobRecord | null> {
  const job = await loadJob(jobId);
  if (!job || !(await canViewJob(user, job))) return null;
  return job;
}

function timingOf(job: JobRecord): JobTiming {
  return {
    action: job.action,
    status: job.status,
    gatewayTaskId: job.gateway_task_id,
    createdAt: job.created_at,
    submittedAt: job.submitted_at,
    updatedAt: job.updated_at,
  };
}

async function refundAndReload(job: JobRecord, reason: string): Promise<JobRecord> {
  const result = await refundJob(job.id, reason);
  if (!result.ok) console.error("jobProgress: refund failed", { jobId: job.id, error: result.error });
  return (await loadJob(job.id)) ?? job;
}

/**
 * Продвинуть задачу на шаг, если пора: опрос шлюза, копирование результата, возврат звёзд
 * за зависшую задачу. Возвращает актуальное состояние.
 */
export async function advanceJob(job: JobRecord): Promise<JobRecord> {
  // Монтаж ведёт студия (загрузка из браузера), шлюз тут ни при чём
  if (job.action === "montage") return job;

  const now = Date.now();
  const timing = timingOf(job);

  switch (job.status) {
    case "queued":
      return isQueuedWithoutTaskTooLong(timing, now) ? refundAndReload(job, refundReason("gateway_lost")) : job;

    case "submitted": {
      if (!job.gateway_task_id) return refundAndReload(job, refundReason("gateway_lost", "no task id"));
      if (!(await claimJobPoll(job.id, GATEWAY_POLL_INTERVAL_SEC))) return job;
      const decision = decideFromGatewayStatus(timing, await getTaskStatus(job.gateway_task_id), now);
      return applyDecision(job, decision);
    }

    case "storing": {
      if (!isStoringStale(timing, now)) return job;
      if (isPastHardLimit(timing, now) || !job.gateway_task_id) {
        return refundAndReload(job, refundReason("result_unavailable", "storing did not finish"));
      }
      if (!(await beginJobStoring(job.id))) return job;
      const decision = decideFromGatewayStatus(timing, await getTaskStatus(job.gateway_task_id), now);
      return applyDecision({ ...job, status: "storing" }, decision, { alreadyClaimed: true });
    }

    default:
      return job;
  }
}

async function applyDecision(
  job: JobRecord,
  decision: GatewayDecision,
  options: { alreadyClaimed?: boolean } = {},
): Promise<JobRecord> {
  if (decision.next === "wait") return job;
  if (decision.next === "refund") return refundAndReload(job, decision.reason);
  if (!options.alreadyClaimed && !(await beginJobStoring(job.id))) return (await loadJob(job.id)) ?? job;
  after(() => storeJobResult(job, decision.urls, decision.credits));
  return { ...job, status: "storing" };
}

/**
 * Скачать результат с доменов kie и положить в media/{user_id}/{job_id}.{ext}.
 * Первый файл обязателен; остальные (второй трек Suno, последний кадр) — по возможности.
 * Сбой сети оставляет задачу в storing: через 3 минуты её перехватит следующий опрос.
 */
export async function storeJobResult(job: JobRecord, urls: string[], credits: number | null): Promise<void> {
  try {
    const stored: { path: string; contentType: string }[] = [];
    for (let i = 0; i < urls.length; i++) {
      const required = stored.length === 0 && i === 0;
      const file = await downloadResult(urls[i]);
      if (!file.ok) {
        if (!required) continue;
        if (file.error === "download_failed") {
          console.error("jobProgress.store: download failed, will retry", { jobId: job.id });
          return;
        }
        await refundJob(job.id, refundReason("result_unavailable", file.error));
        return;
      }
      const path = mediaPath(job.user_id, job.id, file.ext, stored.length);
      const upload = await uploadMedia(path, file.bytes, file.contentType);
      if (!upload.ok) {
        if (!required) continue;
        if (upload.error === "too_large") await refundJob(job.id, refundReason("result_unavailable", "too_large"));
        return;
      }
      stored.push({ path, contentType: file.contentType });
    }
    if (stored.length === 0) {
      await refundJob(job.id, refundReason("result_unavailable", "nothing stored"));
      return;
    }
    const done = await completeJob(job.id, {
      storagePath: stored[0].path,
      extraPaths: stored.slice(1).map((s) => s.path),
      mimeType: stored[0].contentType,
      credits,
    });
    if (!done) console.error("jobProgress.store: job was closed meanwhile", { jobId: job.id });
  } catch (error) {
    console.error("jobProgress.store: unexpected error", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------- DTO ----------

export function jobMediaPaths(job: Pick<JobRecord, "status" | "storage_path" | "extra_paths">): string[] {
  if (job.status !== "done" || !job.storage_path) return [];
  return [job.storage_path, ...job.extra_paths];
}

/**
 * Задачи → JobView с подписанными ссылками (одним запросом на все файлы).
 * Скрытые ведущим результаты отдаются без файлов, если не revealHidden (кабинет ведущего).
 */
export async function toJobViews(
  jobs: JobRecord[],
  options: { revealHidden?: boolean; promptLimit?: number } = {},
): Promise<JobView[]> {
  const visible = (job: JobRecord) => !job.hidden || options.revealHidden;
  const signed = await signMediaPaths(jobs.filter(visible).flatMap(jobMediaPaths));
  return jobs.map((job) => {
    const media: MediaFile[] = visible(job)
      ? jobMediaPaths(job).flatMap((path) => {
          const url = signed.get(path);
          const kind = mediaKindOfPath(path);
          return url && kind ? [{ url, path, kind }] : [];
        })
      : [];
    const prompt = job.prompt && options.promptLimit ? truncate(job.prompt, options.promptLimit) : job.prompt;
    return {
      id: job.id,
      action: job.action,
      model: job.model,
      status: job.status,
      stars: job.stars,
      prompt,
      text: visible(job) ? job.result_text : null,
      media,
      error: job.status === "failed" ? jobErrorCode(job.error) : null,
      hidden: job.hidden,
      lessonId: job.lesson_id,
      taskRef: job.task_ref,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    };
  });
}

export async function toJobView(job: JobRecord, options: { revealHidden?: boolean } = {}): Promise<JobView> {
  return (await toJobViews([job], options))[0];
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
