import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { lessonHasTask, getLessonById } from "@/lib/server/course";
import { isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { appUrl } from "@/lib/server/env";
import {
  createTask,
  generateText,
  isGatewayModel,
  type ModelFor,
  type TaskRequest,
  type VideoRequest,
} from "@/lib/server/gateway";
import { loadJob, toJobView } from "@/lib/server/job-progress";
import { refundReason } from "@/lib/server/job-rules";
import { completeJob, markJobSubmitted } from "@/lib/server/jobs";
import type { ReferenceInput } from "@/lib/server/media-refs";
import { moderateFields } from "@/lib/server/moderation";
import { canUse, LONG_TEXT_TOKENS } from "@/lib/server/prices";
import { resolveReferences } from "@/lib/server/storage";
import type { Json } from "@/lib/server/supabase/types";
import { createJobWithDebit, refundJob, type WalletError } from "@/lib/server/wallet";
import { ASPECT_RATIOS, VOICE_IDS, type JobView } from "@/lib/platform/generation-types";
import type { GenerationErrorCode } from "@/lib/platform/generation-messages";
import type { ErrorCode } from "@/lib/platform/messages";

/*
  POST /api/generate (docs/platform/spec.md §3). Порядок проверок:
    1) вход, роль и возраст против прайса (canUse);
    2) модерация текста (стоп-слова, личные данные);
    3) референсы: только свои файлы из Storage → подписанные ссылки на час;
    4) пауза группы, дневной лимит, баланс и списание — одной SQL-транзакцией (create_job);
    5) отправка в шлюз. Текст — синхронно, остальное — задача, которую опрашивает GET /api/jobs/[id].
  Повтор с тем же idempotencyKey (двойной клик) не списывает дважды и не отправляет в шлюз второй раз.
*/

// ---------- запрос ----------

const MAX_PROMPT = 5000;
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const ref = z.string().trim().min(1).max(2048);

const common = {
  model: z.string().trim().min(1).max(80).optional(),
  lessonId: z.string().regex(/^lesson-[0-9]{1,2}$/).optional(),
  taskId: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
};

const aspectRatio = z.enum(ASPECT_RATIOS).optional();

export const generateRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("text"), prompt: requiredText(MAX_PROMPT), long: z.boolean().optional(), ...common }),
  z.object({ action: z.literal("image"), prompt: requiredText(MAX_PROMPT), aspectRatio, ...common }),
  z.object({
    action: z.literal("image_edit"),
    prompt: requiredText(MAX_PROMPT),
    images: z.array(ref).min(1).max(9),
    aspectRatio,
    ...common,
  }),
  z
    .object({
      action: z.literal("video"),
      prompt: requiredText(MAX_PROMPT),
      images: z.array(ref).max(9).optional(),
      videos: z.array(ref).max(3).optional(),
      audios: z.array(ref).max(3).optional(),
      reference: z.boolean().optional(),
      duration: z.number().int().min(4).max(10).optional(),
      aspectRatio,
      audio: z.boolean().optional(),
      lastFrame: z.boolean().optional(),
      ...common,
    })
    // первый кадр (без reference) — не больше двух картинок и без видео/аудио-референсов
    .refine((v) => v.reference || ((v.images?.length ?? 0) <= 2 && !v.videos?.length && !v.audios?.length), {
      message: "references need reference: true",
    }),
  z.object({
    action: z.literal("motion"),
    images: z.array(ref).length(1),
    video: ref,
    prompt: optionalText(MAX_PROMPT),
    ...common,
  }),
  z.object({
    action: z.literal("lipsync"),
    images: z.array(ref).length(1),
    audio: ref,
    prompt: optionalText(MAX_PROMPT),
    ...common,
  }),
  z.object({
    action: z.literal("voice"),
    text: requiredText(2000),
    style: optionalText(300),
    voice: z.enum(VOICE_IDS).optional(),
    ...common,
  }),
  z.object({
    action: z.literal("music"),
    prompt: requiredText(1000),
    instrumental: z.boolean().optional(),
    lyrics: optionalText(3000),
    title: optionalText(80),
    duration: z.number().int().min(10).max(60).optional(),
    ...common,
  }),
]);

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

// ---------- ответ ----------

export type GenerateErrorCode = ErrorCode | GenerationErrorCode;

export type GenerateOutcome =
  | { kind: "accepted"; jobId: string; balance: number | null; reused: boolean }
  | { kind: "text"; job: JobView; balance: number | null }
  | { kind: "error"; status: number; error: GenerateErrorCode; field?: string; jobId?: string };

const WALLET_STATUS: Record<WalletError, number> = {
  insufficient_stars: 409,
  group_paused: 409,
  daily_cap: 409,
  generation_disabled: 503,
  too_many_jobs: 429,
  unknown_model: 400,
  user_disabled: 403,
  user_not_found: 403,
  bad_amount: 400,
  forbidden: 403,
  job_not_found: 404,
  server_error: 500,
};

const TEXT_SYSTEM =
  "Ты — ИИ-помощник ученика на курсе «ИИ-старт». Отвечай на языке вопроса, по делу и без воды. " +
  "Не проси и не используй личные данные: телефоны, адреса, e-mail. Не выдавай себя за человека. " +
  "Если просят опасное или взрослое — откажись и предложи безопасный вариант.";

// ---------- проверка Origin ----------

/** POST /api/* принимаем только со своего сайта: Origin совпадает с хостом запроса или с APP_URL. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const host = forwarded || request.headers.get("host")?.trim().toLowerCase();
  if (host && host === originHost) return true;
  const app = appUrl();
  return Boolean(app && new URL(app).host.toLowerCase() === originHost);
}

// ---------- основное ----------

export async function startGeneration(user: SessionUser, input: GenerateRequest): Promise<GenerateOutcome> {
  if (input.lessonId && !getLessonById(input.lessonId)) return invalid("lessonId");
  if (input.taskId && !(input.lessonId && lessonHasTask(input.lessonId, input.taskId))) return invalid("taskId");

  // 1. роль и возраст против прайса
  const maxTokens = input.action === "text" ? (input.long ? 2000 : LONG_TEXT_TOKENS) : undefined;
  const duration = input.action === "video" ? (input.duration ?? 5) : undefined;
  const decision = await canUse(user, input.action, input.model, { maxTokens, duration });
  if (!decision.ok) return { kind: "error", status: 403, error: decision.reason };
  if (!isGatewayModel(input.action, decision.model)) return { kind: "error", status: 400, error: "unknown_model" };

  // 2. модерация
  const moderation = moderateFields({
    prompt: "prompt" in input ? input.prompt : undefined,
    text: input.action === "voice" ? input.text : undefined,
    style: input.action === "voice" ? input.style : undefined,
    lyrics: input.action === "music" ? input.lyrics : undefined,
    title: input.action === "music" ? input.title : undefined,
  });
  if (!moderation.ok) {
    after(() =>
      audit({
        actorId: user.id,
        action: "moderation.blocked",
        targetUser: user.id,
        targetGroup: user.group?.id ?? null,
        meta: { reason: moderation.reason, field: moderation.field ?? null, action: input.action },
      }),
    );
    return { kind: "error", status: 422, error: moderation.reason, field: moderation.field };
  }

  // 3. референсы → подписанные ссылки
  const references = await resolveReferences(user, referenceInput(input), {
    libraryOnlyVideo: input.action === "motion" && decision.libraryOnly,
  });
  if (!references.ok) return { kind: "error", status: 403, error: references.error };

  // 4. списание (пауза, лимит, баланс — в SQL)
  const created = await createJobWithDebit({
    userId: user.id,
    action: input.action,
    model: decision.model,
    stars: decision.stars,
    idempotencyKey: input.idempotencyKey,
    params: jobParams(input, references.refs.stored),
    prompt: input.action === "voice" ? input.text : (input.prompt ?? null),
    lessonId: input.lessonId ?? null,
    taskRef: input.taskId ?? null,
  });
  if (!created.ok) return { kind: "error", status: WALLET_STATUS[created.error], error: created.error };

  if (created.reused) return replayOutcome(created.jobId, created.balance);

  // 5. шлюз
  if (input.action === "text") {
    return runText(created.jobId, created.balance, {
      model: decision.model,
      prompt: input.prompt,
      maxTokens: maxTokens ?? LONG_TEXT_TOKENS,
      staff: isStaff(user),
    });
  }
  return submitTask(created.jobId, created.balance, buildTaskRequest(input, decision.model, references.refs.urls));
}

function invalid(field: string): GenerateOutcome {
  return { kind: "error", status: 400, error: "invalid_input", field };
}

/** Двойной клик: та же задача. Текст отдаём, если он уже готов; иначе клиент опрашивает /api/jobs. */
async function replayOutcome(jobId: string, balance: number): Promise<GenerateOutcome> {
  const job = await loadJob(jobId);
  if (job?.action === "text" && job.status === "done") return { kind: "text", job: await toJobView(job), balance };
  return { kind: "accepted", jobId, balance, reused: true };
}

async function runText(
  jobId: string,
  balance: number,
  request: { model: string; prompt: string; maxTokens: number; staff: boolean },
): Promise<GenerateOutcome> {
  const result = await generateText({
    model: request.model as ModelFor<"text">,
    prompt: request.prompt,
    system: request.staff ? undefined : TEXT_SYSTEM,
    maxTokens: request.maxTokens,
  });
  if (!result.ok) {
    await refundJob(jobId, refundReason("gateway_error", result.error));
    return { kind: "error", status: 502, error: "gateway_error", jobId };
  }
  await completeJob(jobId, { text: result.text.slice(0, 20_000), credits: result.credits });
  const job = await loadJob(jobId);
  if (!job) return { kind: "error", status: 500, error: "server_error" };
  return { kind: "text", job: await toJobView(job), balance };
}

async function submitTask(jobId: string, balance: number, request: TaskRequest): Promise<GenerateOutcome> {
  const result = await createTask(request);
  if (result.ok) {
    const marked = await markJobSubmitted(jobId, result.taskId);
    if (!marked) console.error("generate: job left the queue before submit", { jobId });
    return { kind: "accepted", jobId, balance, reused: false };
  }
  if (result.uncertain) {
    // kie мог принять задачу: повторять нельзя. Задача останется в очереди, через несколько
    // минут опрос вернёт звёзды (job-rules: isQueuedWithoutTaskTooLong).
    console.error("generate: gateway result uncertain", { jobId, error: result.error });
    return { kind: "accepted", jobId, balance, reused: false };
  }
  await refundJob(jobId, refundReason("gateway_error", result.error));
  return { kind: "error", status: 502, error: "gateway_error", jobId };
}

// ---------- сборка запроса к шлюзу ----------

function referenceInput(input: GenerateRequest): ReferenceInput {
  switch (input.action) {
    case "image_edit":
      return { images: input.images };
    case "video":
      return { images: input.images, videos: input.videos, audios: input.audios };
    case "motion":
      return { images: input.images, video: input.video };
    case "lipsync":
      return { images: input.images, audio: input.audio };
    default:
      return {};
  }
}

/** Что сохранить в jobs.params: настройки и пути референсов (не подписанные ссылки). */
function jobParams(input: GenerateRequest, refs: ReferenceInput): Record<string, Json | undefined> {
  const base: Record<string, Json | undefined> = { refs: refs as Json };
  switch (input.action) {
    case "text":
      return { ...base, long: input.long ?? false };
    case "image":
    case "image_edit":
      return { ...base, aspectRatio: input.aspectRatio };
    case "video":
      return {
        ...base,
        aspectRatio: input.aspectRatio,
        duration: input.duration ?? 5,
        reference: input.reference ?? false,
        audio: input.audio ?? false,
      };
    case "voice":
      return { ...base, voice: input.voice, style: input.style };
    case "music":
      return {
        ...base,
        instrumental: input.instrumental ?? false,
        title: input.title,
        lyrics: input.lyrics,
        duration: input.duration,
      };
    default:
      return base;
  }
}

function buildTaskRequest(input: Exclude<GenerateRequest, { action: "text" }>, model: string, urls: ReferenceInput): TaskRequest {
  // модель уже проверена по белому списку шлюза (isGatewayModel)
  const m = model as never;
  switch (input.action) {
    case "image":
      return { action: "image", model: m, prompt: input.prompt, aspectRatio: input.aspectRatio ?? "9:16" };
    case "image_edit":
      return { action: "image_edit", model: m, prompt: input.prompt, images: urls.images ?? [], aspectRatio: input.aspectRatio };
    case "video": {
      const request: VideoRequest = {
        action: "video",
        model: m,
        prompt: input.prompt,
        duration: input.duration ?? 5,
        aspectRatio: input.aspectRatio ?? "9:16",
        audio: input.audio ?? false,
      };
      if (urls.images?.length) request.images = urls.images;
      if (input.reference) {
        request.reference = true;
        if (urls.videos?.length) request.videos = urls.videos;
        if (urls.audios?.length) request.audios = urls.audios;
      }
      if (input.lastFrame && model === "bytedance/seedance-2-5") request.lastFrame = true;
      return request;
    }
    case "motion":
      return { action: "motion", model: m, images: [urls.images![0]], video: urls.video!, prompt: input.prompt };
    case "lipsync":
      return { action: "lipsync", model: m, images: [urls.images![0]], audio: urls.audio!, prompt: input.prompt };
    case "voice":
      return { action: "voice", model: m, text: input.text, style: input.style, voice: input.voice };
    case "music":
      return {
        action: "music",
        model: m,
        prompt: input.prompt,
        instrumental: input.instrumental,
        lyrics: input.lyrics,
        title: input.title,
        duration: input.duration,
      };
  }
}
