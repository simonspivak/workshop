import "server-only";
import { createAdminClient } from "@/lib/server/supabase/admin";

/*
  Переходы состояния задачи генерации (без денег). Деньги — lib/server/wallet.ts.

    queued ──mark_job_submitted──▶ submitted ──begin_job_storing──▶ storing ──complete_job──▶ done
       │                              │                                │
       └──────────── refund_job (возврат звёзд) ────────────────────────┴──▶ failed

  Cron нет (Vercel Hobby): статус опрашивается лениво из GET /api/jobs/[id].
  claimJobPoll не даёт спрашивать шлюз чаще раза в 5 секунд на задачу.
  Текстовые задачи синхронные: queued → complete_job сразу.
*/

async function rpcBoolean(name: string, call: PromiseLike<{ data: boolean | null; error: { code?: string } | null }>) {
  const { data, error } = await call;
  if (error) {
    console.error(`jobs.${name}: rpc failed`, { code: error.code });
    throw new Error(`jobs.${name} failed`);
  }
  return data === true;
}

/** Шлюз принял задачу. false — задача уже не в очереди (повтор или гонка). */
export function markJobSubmitted(jobId: string, gatewayTaskId: string): Promise<boolean> {
  return rpcBoolean(
    "markJobSubmitted",
    createAdminClient().rpc("mark_job_submitted", { p_job: jobId, p_task_id: gatewayTaskId }),
  );
}

/** true — этот запрос может спросить шлюз о статусе (последний опрос был не раньше minIntervalSec назад). */
export function claimJobPoll(jobId: string, minIntervalSec = 5): Promise<boolean> {
  return rpcBoolean("claimJobPoll", createAdminClient().rpc("claim_job_poll", { p_job: jobId, p_min_interval: minIntervalSec }));
}

/** true — этот обработчик единственный копирует результат в Storage (зависшее копирование > 3 мин можно перехватить). */
export function beginJobStoring(jobId: string): Promise<boolean> {
  return rpcBoolean("beginJobStoring", createAdminClient().rpc("begin_job_storing", { p_job: jobId }));
}

/** Задача готова. storagePath — путь в бакете media: {user_id}/{job_id}.{ext}. */
export function completeJob(
  jobId: string,
  result: {
    storagePath?: string | null;
    extraPaths?: string[];
    mimeType?: string | null;
    text?: string | null;
    credits?: number | null;
  },
): Promise<boolean> {
  return rpcBoolean(
    "completeJob",
    createAdminClient().rpc("complete_job", {
      p_job: jobId,
      p_storage_path: result.storagePath ?? null,
      p_extra_paths: result.extraPaths ?? [],
      p_mime_type: result.mimeType ?? null,
      p_result_text: result.text ?? null,
      p_credits: result.credits ?? null,
    }),
  );
}

/** Путь файла результата в бакете media. */
export function mediaPath(userId: string, jobId: string, ext: string, index = 0): string {
  return index === 0 ? `${userId}/${jobId}.${ext}` : `${userId}/${jobId}-${index + 1}.${ext}`;
}

export const MEDIA_BUCKET = "media";
