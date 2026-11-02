import "server-only";
import { createHash } from "node:crypto";
import { cardsAvailable } from "@/lib/server/bot/brain";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { verifyCardTicket } from "@/lib/server/bot/secrets";
import { lifetimeOf, priceSubject, type BotRecord } from "@/lib/server/bot/store";
import { createTask, downloadResult, getTaskStatus, isGatewayModel, type ModelFor } from "@/lib/server/gateway";
import { beginJobStoring, claimJobPoll, completeJob, markJobSubmitted, MEDIA_BUCKET, mediaPath } from "@/lib/server/jobs";
import { moderateText } from "@/lib/server/moderation";
import { canUse } from "@/lib/server/prices";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Json } from "@/lib/server/supabase/types";
import { createJobWithDebit, refundJob, type WalletError } from "@/lib/server/wallet";

/*
  Инструмент «Открытка» (docs/course/lesson-3.md §7.2, §8.3, §14.4):
    • бот предлагает сцену служебной строкой, сервер выдаёт подписанный «билет» (scene, бот, диалог);
    • гость подтверждает кнопкой с ценой — только тогда списываются звёзды владельца;
    • задача — обычная задача генерации владельца (jobs, его галерея), action image_edit с аватаром
      бота в image_input или image без аватара; модель — первая доступная владельцу по прайсу;
    • гостям — только у ботов 18+ и не больше 3 в сутки; в проверке владельцем — без лимита.
  Статус спрашивается лениво (как /api/jobs/[id]): опрос шлюза не чаще раза в 4 секунды,
  результат копируется в приватный бакет media, ссылка — подписанная на час.
*/

const STYLE =
  "Single character, no real people, no brands. High-end 3D animation for an adult comedy-drama mini-series, " +
  "cinematic moody lighting, warm Hanukkah candle glow and soft bokeh in the background, shallow depth of field, " +
  "rich realistic food textures, vertical 9:16 frame, no text, no logos, no watermark";

export function cardPrompt(input: { name: string; scene: string; withReference: boolean }): string {
  const scene = `Scene: ${input.scene}.`;
  return input.withReference
    ? `Use the character from the reference image. Keep exactly the same design, colors and details. ${scene} ${STYLE}`
    : `Character: ${input.name}, a food character from the comedy series «На масле». ${scene} ${STYLE}`;
}

export type CardError = "card_unavailable" | "card_ticket" | "card_limit" | WalletError;

const taskRef = (botId: string) => `bot-card:${botId}`;
const SIGNED_URL_SECONDS = 3600;

/** Путь картинки-аватара в Storage, если это готовая картинка владельца. */
export async function avatarPath(bot: Pick<BotRecord, "avatarJobId" | "ownerId">): Promise<string | null> {
  if (!bot.avatarJobId) return null;
  const { data } = await createAdminClient()
    .from("jobs")
    .select("user_id, status, action, storage_path, hidden")
    .eq("id", bot.avatarJobId)
    .maybeSingle();
  if (!data || data.user_id !== bot.ownerId || data.status !== "done" || data.hidden || !data.storage_path) return null;
  if (data.action !== "image" && data.action !== "image_edit") return null;
  return data.storage_path;
}

export async function signedMediaUrl(path: string, seconds = SIGNED_URL_SECONDS): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUrl(path, seconds);
  return error || !data ? null : data.signedUrl;
}

export async function startCard(input: {
  bot: BotRecord;
  conversationId: string;
  preview: boolean;
  ticket: string;
}): Promise<{ ok: true; jobId: string; stars: number } | { ok: false; error: CardError }> {
  const { bot } = input;
  if (!bot.active || lifetimeOf(bot).retired || !cardsAvailable(bot, "web", input.preview)) {
    return { ok: false, error: "card_unavailable" };
  }
  const scene = verifyCardTicket(input.ticket, { botId: bot.id, conversationId: input.conversationId });
  if (!scene) return { ok: false, error: "card_ticket" };
  if (!moderateText(scene, { maxLength: 200 }).ok) return { ok: false, error: "card_unavailable" };

  const db = createAdminClient();
  if (!input.preview) {
    const { count, error } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", bot.ownerId)
      .eq("task_ref", taskRef(bot.id))
      .filter("params->>preview", "eq", "false")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if (error) throw new Error(`bot.card.count failed (${error.code})`);
    if ((count ?? 0) >= BOT_LIMITS.cardsPerBotPerDay) return { ok: false, error: "card_limit" };
  }

  const reference = await avatarPath(bot);
  const referenceUrl = reference ? await signedMediaUrl(reference) : null;
  const action = referenceUrl ? "image_edit" : "image";
  const decision = await canUse(priceSubject(bot.owner), action);
  if (!decision.ok || !isGatewayModel(action, decision.model)) return { ok: false, error: "card_unavailable" };

  const prompt = cardPrompt({ name: bot.name, scene, withReference: Boolean(referenceUrl) });
  const idempotencyKey = `card:${createHash("sha256").update(input.ticket).digest("hex").slice(0, 48)}`;
  const params: Record<string, Json> = {
    source: "bot_card",
    botId: bot.id,
    conversation: input.conversationId,
    preview: input.preview,
    aspectRatio: "9:16",
    scene,
  };
  const job = await createJobWithDebit({
    userId: bot.ownerId,
    action,
    model: decision.model,
    stars: decision.stars,
    idempotencyKey,
    params,
    prompt,
    taskRef: taskRef(bot.id),
  });
  if (!job.ok) return { ok: false, error: job.error };
  if (job.reused) return { ok: true, jobId: job.jobId, stars: decision.stars };

  const task =
    action === "image_edit" && referenceUrl
      ? await createTask({
          action: "image_edit",
          model: decision.model as ModelFor<"image_edit">,
          prompt,
          images: [referenceUrl],
          aspectRatio: "9:16",
        })
      : await createTask({
          action: "image",
          model: decision.model as ModelFor<"image">,
          prompt,
          aspectRatio: "9:16",
        });
  if (!task.ok) {
    await refundJob(job.jobId, `gateway: ${task.error}`.slice(0, 200));
    return { ok: false, error: "server_error" };
  }
  await markJobSubmitted(job.jobId, task.taskId);
  return { ok: true, jobId: job.jobId, stars: decision.stars };
}

export type CardStatus = { status: "pending" } | { status: "done"; url: string } | { status: "failed" };

/**
 * Статус открытки. access.conversationId — гость видит только открытки своего диалога;
 * owner — владелец видит открытки своего бота. null — нет такой открытки (или чужая).
 */
export async function pollCard(
  bot: Pick<BotRecord, "id" | "ownerId">,
  jobId: string,
  access: { owner: true } | { conversationId: string },
): Promise<CardStatus | null> {
  const db = createAdminClient();
  const { data: job, error } = await db
    .from("jobs")
    .select("id, user_id, status, gateway_task_id, storage_path, params, task_ref, created_at")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`bot.card.poll failed (${error.code})`);
  if (!job || job.user_id !== bot.ownerId || job.task_ref !== taskRef(bot.id)) return null;
  const params = (job.params ?? {}) as Record<string, unknown>;
  if ("conversationId" in access && params.conversation !== access.conversationId) return null;

  if (job.status === "done") {
    const url = job.storage_path ? await signedMediaUrl(job.storage_path) : null;
    return url ? { status: "done", url } : { status: "failed" };
  }
  if (job.status === "failed") return { status: "failed" };
  if (!job.gateway_task_id) return { status: "pending" };

  if (job.status === "submitted") {
    if (!(await claimJobPoll(job.id, 4))) return { status: "pending" };
    const state = await getTaskStatus(job.gateway_task_id);
    if (!state.ok || !state.done) return { status: "pending" };
    if (state.state !== "success" || state.urls.length === 0) {
      await refundJob(job.id, (state.error ?? "generation failed").slice(0, 200));
      return { status: "failed" };
    }
    if (!(await beginJobStoring(job.id))) return { status: "pending" };
    return storeCard(bot.ownerId, job.id, state.urls[0], state.credits);
  }

  // Зависшее копирование (> 3 минут) можно перехватить
  if (job.status === "storing" && (await beginJobStoring(job.id))) {
    const state = await getTaskStatus(job.gateway_task_id);
    if (!state.ok || state.state !== "success" || state.urls.length === 0) return { status: "pending" };
    return storeCard(bot.ownerId, job.id, state.urls[0], state.credits);
  }
  return { status: "pending" };
}

async function storeCard(ownerId: string, jobId: string, resultUrl: string, credits: number | null): Promise<CardStatus> {
  const file = await downloadResult(resultUrl);
  if (!file.ok || !file.contentType.startsWith("image/")) {
    await refundJob(jobId, `download: ${file.ok ? "bad_type" : file.error}`);
    return { status: "failed" };
  }
  const path = mediaPath(ownerId, jobId, file.ext);
  const upload = await createAdminClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, file.bytes, { contentType: file.contentType, upsert: true });
  if (upload.error) {
    console.error("bot.card: storage upload failed", { job: jobId });
    return { status: "pending" };
  }
  await completeJob(jobId, { storagePath: path, mimeType: file.contentType, credits });
  const url = await signedMediaUrl(path);
  return url ? { status: "done", url } : { status: "pending" };
}
