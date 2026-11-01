import "server-only";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { JobAction, Json } from "@/lib/server/supabase/types";

/*
  Кошелёк: все изменения звёзд — только через SQL-функции security definer
  (supabase/migrations/…_init.sql), которые может вызвать только service_role.
  Баланс не уходит в минус (check в таблице), каждая операция пишется в star_ledger.

  Ошибки SQL приходят как текст исключения; здесь они превращаются в коды WalletError.
*/

export type WalletError =
  | "insufficient_stars"
  | "group_paused"
  | "daily_cap"
  | "generation_disabled"
  | "too_many_jobs"
  | "unknown_model"
  | "user_disabled"
  | "user_not_found"
  | "bad_amount"
  | "forbidden"
  | "job_not_found"
  | "server_error";

const KNOWN: readonly WalletError[] = [
  "insufficient_stars",
  "group_paused",
  "daily_cap",
  "generation_disabled",
  "too_many_jobs",
  "unknown_model",
  "user_disabled",
  "user_not_found",
  "bad_amount",
  "forbidden",
  "job_not_found",
];

function toWalletError(error: { message?: string; code?: string } | null, op: string): WalletError {
  const message = error?.message ?? "";
  const known = KNOWN.find((code) => message === code);
  if (known) return known;
  console.error(`wallet.${op}: unexpected error`, { code: error?.code, message: message.slice(0, 200) });
  return "server_error";
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: WalletError };

export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`wallet.getBalance failed: ${error.code}`);
  return data?.balance ?? 0;
}

/**
 * Создать задачу генерации и списать звёзды одной транзакцией.
 * Порядок проверок в SQL: пользователь → пауза группы → дневной лимит → баланс.
 * Повтор с тем же idempotencyKey (двойной клик) вернёт ту же задачу без второго списания (reused).
 * stars = 0 — бесплатно (учитель, админ, монтаж). Цену считает prices.canUse().
 */
export async function createJobWithDebit(input: {
  userId: string;
  action: JobAction;
  model: string;
  stars: number;
  idempotencyKey: string;
  params?: Record<string, Json | undefined>;
  prompt?: string | null;
  lessonId?: string | null;
  taskRef?: string | null;
}): Promise<Result<{ jobId: string; balance: number; reused: boolean }>> {
  const { data, error } = await createAdminClient().rpc("create_job", {
    p_user: input.userId,
    p_action: input.action,
    p_model: input.model,
    p_stars: input.stars,
    p_idempotency_key: input.idempotencyKey,
    p_params: (input.params ?? {}) as Json,
    p_prompt: input.prompt ?? null,
    p_lesson_id: input.lessonId ?? null,
    p_task_ref: input.taskRef ?? null,
  });
  const row = data?.[0];
  if (error || !row) return { ok: false, error: toWalletError(error, "createJobWithDebit") };
  return { ok: true, jobId: row.job_id, balance: row.balance, reused: row.reused };
}

/**
 * Закрыть задачу как неудачную и вернуть списанное. Повторный вызов ничего не делает,
 * готовую (done) задачу вернуть нельзя. refunded — сколько звёзд вернулось (0, если нечего).
 */
export async function refundJob(jobId: string, reason: string): Promise<Result<{ refunded: number; balance: number }>> {
  const { data, error } = await createAdminClient().rpc("refund_job", { p_job: jobId, p_error: reason.slice(0, 500) });
  const row = data?.[0];
  if (error || !row) return { ok: false, error: toWalletError(error, "refundJob") };
  return { ok: true, refunded: row.refunded, balance: row.balance };
}

/**
 * Начислить (amount > 0) или снять (amount < 0) звёзды. SQL сам проверяет, что actor —
 * админ или учитель группы ученика, и пишет audit_log. До ±10000 за раз.
 */
export async function grantStars(input: {
  actorId: string;
  userId: string;
  amount: number;
  note?: string | null;
  idempotencyKey?: string | null;
}): Promise<Result<{ balance: number }>> {
  const { data, error } = await createAdminClient().rpc("grant_stars", {
    p_actor: input.actorId,
    p_user: input.userId,
    p_amount: input.amount,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error || typeof data !== "number") return { ok: false, error: toWalletError(error, "grantStars") };
  return { ok: true, balance: data };
}

/**
 * Списать звёзды без задачи генерации — сейчас только ответ бота (1★ со звёзд владельца).
 * idempotencyKey — id входящего сообщения (для Telegram — update_id): повтор не списывает.
 * charged = false — уже списано раньше. insufficient_stars — бот «отдыхает».
 */
export async function spendStars(input: {
  userId: string;
  amount: number;
  reason: "bot_reply";
  idempotencyKey: string;
  ref?: string | null;
}): Promise<Result<{ balance: number; charged: boolean }>> {
  const { data, error } = await createAdminClient().rpc("spend_stars", {
    p_user: input.userId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_ref: input.ref ?? null,
  });
  const row = data?.[0];
  if (error || !row) return { ok: false, error: toWalletError(error, "spendStars") };
  return { ok: true, balance: row.balance, charged: row.charged };
}

/**
 * Засчитать тест урока (одна попытка на урок) и один раз начислить бонус.
 * score/maxScore/bonus считает сервер (submitQuiz), правильные ответы в браузер не уходят.
 * alreadyDone = true — попытка уже была, возвращается её результат, бонус не начисляется.
 */
export async function recordQuizAttempt(input: {
  userId: string;
  lessonId: string;
  answers: number[];
  score: number;
  maxScore: number;
  bonus: number;
}): Promise<
  Result<{ attemptId: string; score: number; maxScore: number; bonus: number; balance: number; alreadyDone: boolean }>
> {
  const { data, error } = await createAdminClient().rpc("record_quiz_attempt", {
    p_user: input.userId,
    p_lesson_id: input.lessonId,
    p_answers: input.answers,
    p_score: input.score,
    p_max_score: input.maxScore,
    p_bonus: input.bonus,
  });
  const row = data?.[0];
  if (error || !row) return { ok: false, error: toWalletError(error, "recordQuizAttempt") };
  return {
    ok: true,
    attemptId: row.attempt_id,
    score: row.score,
    maxScore: row.max_score,
    bonus: row.bonus,
    balance: row.balance,
    alreadyDone: row.already_done,
  };
}
