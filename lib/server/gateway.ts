import "server-only";
import { randomBytes } from "node:crypto";
import { deadlineSignal } from "@/lib/server/deadline";
import { gatewayConfig } from "@/lib/server/env";
import { MEDIA_FILE_MAX_BYTES } from "@/lib/server/media-refs";
import { mockMedia, type MockMediaKind } from "@/lib/server/mock-media";

/*
  Клиент шлюза kie в n8n (контракт — docs/kie-gateway.md).
  POST KIE_GATEWAY_URL, заголовок x-iistart-key, тело { action, ... }.
  Ключа kie на Vercel нет. Если KIE_GATEWAY_URL не задан — mock-режим: сеть не трогаем,
  отвечаем заглушками той же формы (см. «Mock-режим» внизу).

  Ответы шлюза:
    text            → { ok, text, credits }
    image … music   → { ok, taskId, state: 'queued' }  (в запросе — jobId и, если есть, callbackUrl)
    status          → { ok, state, done, urls[], credits, error, lastFrame }
    balance         → { ok, credits }
  Ошибка → { ok: false, error, httpStatus?, kieCode?, uncertain? }. Для ошибок сети и таймаутов
  error — наш код (gateway_unreachable, gateway_timeout, gateway_bad_response).
  kieCode — код kie (поле code ответа kie), шлюз кладёт его рядом с httpStatus 502:
  по нему отличаем постоянный отказ (нет кредитов, неверный запрос) от перегрузки и 429.
*/

// ---------- модели (белый список шлюза; первая — по умолчанию) ----------

export const GATEWAY_MODELS = {
  // kimi-k3 — запасная (шлюз собирает её в «Доработке запроса», см. docs/kie-gateway.md)
  text: ["claude-haiku-5-5", "gpt-6-luna", "claude-sonnet-5-5", "kimi-k3"],
  image: ["nano-banana-2-1", "flux-3/klein-text-to-image", "nano-banana-pro"],
  image_edit: ["nano-banana-2-1", "flux-3/klein-edit-image", "nano-banana-pro"],
  video: [
    "bytedance/seedance-2-mini",
    "bytedance/seedance-2-5",
    "wan/3-0-video",
    "wan/3-0-video-prime",
    "kling-4.0/reference-to-video",
  ],
  motion: ["kling-2.6/motion-control", "wan/2-2-animate-move"],
  lipsync: ["kling/ai-avatar-standard", "infinitalk/from-audio"],
  // ElevenLabs V3 шлюз собирает в «Доработке запроса» (docs/kie-gateway.md): эмоции — тегами в тексте, [excitedly]
  voice: ["google/gemini-3-8-flash-tts", "elevenlabs/text-to-dialogue-v3"],
  music: ["ai-music-api/generate"],
} as const;

export type GatewayTaskAction = Exclude<keyof typeof GATEWAY_MODELS, "text">;
export type ModelFor<A extends keyof typeof GATEWAY_MODELS> = (typeof GATEWAY_MODELS)[A][number];

export function isGatewayModel(action: string, model: string): boolean {
  const list = (GATEWAY_MODELS as Record<string, readonly string[]>)[action];
  return Boolean(list?.includes(model));
}

// ---------- запросы ----------

export type TextRequest = {
  action: "text";
  model?: ModelFor<"text">;
  prompt: string;
  system?: string;
  /** ≤ 2000; по умолчанию 800 */
  maxTokens?: number;
  /**
   * Картинки для модели: https-ссылки (подписанные ссылки Storage), не больше MAX_TEXT_IMAGES.
   * Пусто или нет — поля images в запросе к шлюзу нет, всё как раньше. Есть — цепочка моделей
   * только из VISION_TEXT_MODELS (docs/kie-gateway.md, «Картинки в тексте»).
   */
  images?: string[];
};
export type ImageRequest = { action: "image"; model?: ModelFor<"image">; prompt: string; aspectRatio?: string };
export type ImageEditRequest = {
  action: "image_edit";
  model?: ModelFor<"image_edit">;
  prompt: string;
  images: string[];
  aspectRatio?: string;
};
export type VideoRequest = {
  action: "video";
  model?: ModelFor<"video">;
  prompt: string;
  /** первый (и последний) кадр; с reference: true — референсы */
  images?: string[];
  duration?: number;
  aspectRatio?: string;
  /** звук модели; для речи по-русски не годится (см. docs/kie-gateway.md) */
  audio?: boolean;
  resolution?: "480p" | "720p";
  reference?: boolean;
  videos?: string[];
  audios?: string[];
  /** только Seedance 2.5: вернуть последний кадр */
  lastFrame?: boolean;
  /** только Kling 4.0 */
  elements?: { name: string; images: string[]; tag?: string; description?: string }[];
  voices?: { name: string; audio: string }[];
};
export type MotionRequest = {
  action: "motion";
  model?: ModelFor<"motion">;
  /** images[0] — персонаж */
  images: [string, ...string[]];
  /** видео-драйвер с движением */
  video: string;
  prompt?: string;
};
export type LipsyncRequest = {
  action: "lipsync";
  model?: ModelFor<"lipsync">;
  images: [string, ...string[]];
  audio: string;
  prompt?: string;
};
export type VoiceRequest = {
  action: "voice";
  model?: ModelFor<"voice">;
  text: string;
  /** манера речи — только Gemini TTS; у ElevenLabs эмоции задают тегами в тексте */
  style?: string;
  /** голос по имени: Gemini — по умолчанию Kore, ElevenLabs — Sarah */
  voice?: string;
};
export type MusicRequest = {
  action: "music";
  model?: ModelFor<"music">;
  prompt: string;
  instrumental?: boolean;
  lyrics?: string;
  title?: string;
  /**
   * Длина трека, 10–120 с. Только в custom-режиме Suno (instrumental или свой lyrics).
   * «Build KIE Request» режет до 60 с, до 120 — «Доработка запроса» (docs/kie-gateway.md, «Музыка: длина и голос»).
   */
  duration?: number;
  /** Голос певца: m — мужской, f — женский. Только для песни со своим текстом (lyrics), не для instrumental. */
  vocalGender?: "m" | "f";
};

export type TaskRequest =
  | ImageRequest
  | ImageEditRequest
  | VideoRequest
  | MotionRequest
  | LipsyncRequest
  | VoiceRequest
  | MusicRequest;

// ---------- ответы ----------

export type GatewayErrorCode = "gateway_unreachable" | "gateway_timeout" | "gateway_bad_response";

export type GatewayFailure = {
  ok: false;
  /** текст ошибки шлюза/kie или наш код GatewayErrorCode */
  error: string;
  /** HTTP-статус, если шлюз его вернул */
  httpStatus?: number;
  /** код kie из тела ответа шлюза (kieCode), если шлюз его передал */
  kieCode?: number;
  /**
   * true — неизвестно, создана ли задача у kie (таймаут или обрыв после отправки).
   * Повторять такой запрос автоматически нельзя: kie может списать дважды.
   */
  uncertain?: boolean;
  /** в запросе были картинки, и шлюз или модель отказали из-за них: повтор не поможет */
  imagesRejected?: boolean;
};

export type TextResult = { ok: true; text: string; model?: string; credits: number | null } | GatewayFailure;
export type CreateTaskResult = { ok: true; taskId: string; model?: string; state: string } | GatewayFailure;
export type TaskState = "waiting" | "queuing" | "generating" | "success" | "fail" | (string & {});
export type TaskStatusResult =
  | {
      ok: true;
      taskId: string;
      state: TaskState;
      done: boolean;
      urls: string[];
      lastFrame?: string;
      credits: number | null;
      error?: string;
      progress?: number | null;
    }
  | GatewayFailure;
export type BalanceResult = { ok: true; credits: number | null } | GatewayFailure;

// Шлюз ждёт kie не дольше 40 с (POST) и 12 с (GET). Создание задачи платформа ждёт дольше (45 с),
// чтобы не вернуть звёзды за задачу, которую kie всё-таки создал. Текст — 42 с: n8n всё равно
// обрывает kie на 40 с, а функция /api/generate живёт до 60 с (maxDuration) — остаток нужен на
// списание и возврат звёзд (аудит № 22). Текст не бывает uncertain, ранний таймаут = ранний возврат.
const TIMEOUT_MS = { text: 42_000, create: 45_000, status: 15_000, balance: 10_000 };

// ---------- публичное API ----------

export function isMockMode(): boolean {
  return gatewayConfig().mode === "mock";
}

/*
  Повторы (docs/kie-gateway.md, «Ошибки шлюза»). Вид отказа — failureKind():
    transient    — kie перегружен (502/503 «Resources are tight»), сеть: короткие паузы 1,5/3/5/8 с,
                   для текста ученика — следующая модель цепочки (TEXT_CHAIN_FOR_HAIKU);
    rate_limited — 429 (kie: ~20 новых генераций за 10 с на аккаунт, без очереди): длинные паузы
                   ~10/12/14 с с разбросом ±30 %, чтобы класс, нажавший разом, не бился пачкой снова;
    permanent    — kie 4xx кроме 429 (нет кредитов, неверный ключ, плохой запрос): без повторов
                   и без запасных моделей — на том же аккаунте kie они не пройдут;
    final        — таймаут или «неизвестно, создана ли задача»: не повторяем, kie мог списать.
*/
// Окна перегрузки kie длятся минутами, но часть запросов проходит: до 5 попыток
const RETRY_DELAYS_MS = [1500, 3000, 5000, 8000];
// 429: окно kie — 10 с, поэтому пауза не короче окна, плюс разброс ±30 %
const RATE_LIMIT_DELAYS_MS = [10_000, 12_000, 14_000];
const RATE_LIMIT_JITTER = 0.3;
/** Вся попытка с повторами укладывается в функцию (maxDuration 60 с) с запасом на базу. */
const RETRY_BUDGET_MS = { text: TIMEOUT_MS.text, create: TIMEOUT_MS.create };
/** Меньше этого на следующую попытку не остаётся — не повторяем. */
const MIN_ATTEMPT_MS = 10_000;
/**
 * Создание задачи: ответ без поля ok (ошибка самого n8n, не «Normalize Response») через столько
 * времени значит, что n8n упал на ожидании kie (KIE POST режется на 40 с) — kie мог создать задачу.
 * Быстрый такой ответ (битый ответ kie, сбой сети) остаётся временным и повторяется (аудит № 20).
 */
const UNCERTAIN_AFTER_MS = 30_000;
// Решение Сени 10 ноября: основная текстовая модель — Kimi K3 (быстро и стабильно отвечает,
// Haiku на kie весь ноябрь отказывает). Haiku и GPT — запасные. Прайс и уроки по-прежнему
// называют модель claude-haiku-5-5 — это «чат ученика», а сюда она переводится в цепочку.
const TEXT_CHAIN_FOR_HAIKU: ModelFor<"text">[] = ["kimi-k3", "kimi-k3", "claude-haiku-5-5", "kimi-k3", "gpt-6-luna"];

/*
  Картинки в тексте (16 ноября 2026). По сохранённой документации kie картинки на входе принимают:
    kimi-k3    — /openai/v1/responses, часть {"type":"input_image","image_url":"<URL или data:image/…;base64,…>"};
    gpt-6-luna — /codex/v1/responses, та же часть input_image («Multimodal Input»).
  У claude-haiku-5-5 и claude-sonnet-5-5 на kie content — «Structured content blocks» без описания
  блоков: картинки не документированы, туда их не шлём. Список — только модели, где они документированы.
*/
export const VISION_TEXT_MODELS: readonly ModelFor<"text">[] = ["kimi-k3", "gpt-6-luna"];
/** Больше стольких картинок в один текстовый запрос не уходит (шлюз проверяет то же). */
export const MAX_TEXT_IMAGES = 6;
const IMAGE_FAILURE_TEXT = /image|картин/i;

/**
 * Модели по попыткам. Без картинок — как раньше: цепочка для Haiku или одна модель 5 раз.
 * С картинками — та же цепочка без моделей, у которых картинки не документированы; если
 * в ней ничего не осталось (просили модель без картинок) — цепочка Haiku без них же.
 */
export function textChain(primary: ModelFor<"text">, withImages: boolean): ModelFor<"text">[] {
  const base: ModelFor<"text">[] =
    primary === "claude-haiku-5-5" ? TEXT_CHAIN_FOR_HAIKU : [primary, primary, primary, primary, primary];
  if (!withImages) return base;
  const vision = base.filter((model) => VISION_TEXT_MODELS.includes(model));
  return vision.length ? vision : TEXT_CHAIN_FOR_HAIKU.filter((model) => VISION_TEXT_MODELS.includes(model));
}

/** Картинки для шлюза: только https, без повторов, не больше MAX_TEXT_IMAGES. */
export function textImages(images: readonly string[] | undefined): string[] {
  const ok = (images ?? []).filter((url) => typeof url === "string" && url.startsWith("https://") && url.length <= 2048);
  return [...new Set(ok)].slice(0, MAX_TEXT_IMAGES);
}

export type FailureKind = "transient" | "rate_limited" | "permanent" | "final";

/** Коды, при которых не пройдёт ни одна генерация: кредиты, ключ, доступ, адрес шлюза, техработы kie. */
const ACCOUNT_CODES = [401, 402, 403, 404, 455, 505];
// Текст отказа, если кода нет (текстовый маршрут шлюза пока не передаёт kieCode)
const ACCOUNT_TEXT = /insufficient|not enough credits|credits? (?:exhausted|run out)|unauthori[sz]ed|invalid api key/i;
const RATE_LIMIT_TEXT = /too many requests|rate limit/i;
const TRANSIENT_TEXT = /resources are tight|try again later|overload|capacity|busy/i;

/** Код отказа: kieCode, если шлюз его передал (4xx/5xx), иначе HTTP-статус ответа шлюза. */
function failureCode(result: GatewayFailure): number {
  const kie = result.kieCode;
  if (kie !== undefined && kie >= 400 && kie < 600) return kie;
  return result.httpStatus ?? 0;
}

export function failureKind(result: GatewayFailure): FailureKind {
  if (result.imagesRejected) return "permanent";
  if (result.uncertain || result.error === "gateway_timeout") return "final";
  if (result.error === "gateway_unreachable") return "transient";
  const code = failureCode(result);
  if (code === 429 || RATE_LIMIT_TEXT.test(result.error)) return "rate_limited";
  // «перегружен, попробуйте позже» — временный отказ, с каким бы кодом kie его ни прислал
  if (TRANSIENT_TEXT.test(result.error) && !ACCOUNT_TEXT.test(result.error)) return "transient";
  if ((code >= 400 && code < 500) || ACCOUNT_TEXT.test(result.error)) return "permanent";
  if (code >= 500 || TRANSIENT_TEXT.test(result.error)) return "transient";
  return "final";
}

/** Временный отказ kie или шлюза: можно повторить. */
export function isTransientFailure(result: GatewayFailure): boolean {
  const kind = failureKind(result);
  return kind === "transient" || kind === "rate_limited";
}

/** Постоянный отказ (kie 4xx кроме 429): повтор не поможет. */
export function isPermanentFailure(result: GatewayFailure): boolean {
  return failureKind(result) === "permanent";
}

/** Постоянный отказ всего аккаунта kie или шлюза (нет кредитов, ключ): нужен ведущий. */
export function isAccountFailure(result: GatewayFailure): boolean {
  return isPermanentFailure(result) && (ACCOUNT_CODES.includes(failureCode(result)) || ACCOUNT_TEXT.test(result.error));
}

/** Время и случайность повторов. В тестах подменяется (options.clock). */
export type RetryClock = { now: () => number; random: () => number; sleep: (ms: number) => Promise<void> };

const realClock: RetryClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Пауза перед повтором номер retryIndex + 1 (0 — перед второй попыткой) после отказа failure. */
export function retryDelayMs(failure: GatewayFailure, retryIndex: number, random: () => number): number {
  const pick = (list: number[]) => list[Math.min(retryIndex, list.length - 1)];
  if (failureKind(failure) !== "rate_limited") return pick(RETRY_DELAYS_MS);
  const spread = 1 - RATE_LIMIT_JITTER + 2 * RATE_LIMIT_JITTER * random();
  return Math.round(pick(RATE_LIMIT_DELAYS_MS) * spread);
}

/** Повторы: attempt(i, timeoutMs) вызывается, пока ответ временный и хватает времени. */
async function withRetries<T extends { ok: true } | GatewayFailure>(
  budgetMs: number,
  attempts: number,
  attempt: (index: number, timeoutMs: number) => Promise<T>,
  clock: RetryClock,
): Promise<T> {
  const started = clock.now();
  let result = await attempt(0, budgetMs);
  for (let i = 1; i < attempts; i++) {
    if (result.ok || !isTransientFailure(result)) return result;
    const delay = retryDelayMs(result, i - 1, clock.random);
    const left = budgetMs - (clock.now() - started) - delay;
    if (left < MIN_ATTEMPT_MS) return result;
    await clock.sleep(delay);
    result = await attempt(i, left);
  }
  return result;
}

/** Необязательные настройки вызова шлюза. clock — только для тестов. */
export type GatewayCallOptions = { clock?: RetryClock };
export type GenerateTextOptions = GatewayCallOptions & {
  /** не больше стольких попыток (боты: публичный запрос не ждёт всю цепочку) */
  maxAttempts?: number;
  /** потолок ожидания одной попытки, мс (боты: гость не ждёт 40 с зависшей модели) */
  attemptTimeoutMs?: number;
};
export type CreateTaskOptions = GatewayCallOptions & {
  /**
   * id задачи платформы: уходит в шлюз полем jobId, одинаковым во всех повторах этой задачи.
   * По нему шлюз может не создавать у kie вторую задачу и найти потерянный taskId (docs/kie-gateway.md).
   */
  jobId?: string;
  /**
   * Адрес обратного вызова «задача закончилась» (lib/server/job-callback.ts): уходит в шлюз полем
   * callbackUrl, шлюз передаёт его kie как callBackUrl (docs/kie-gateway.md, «Обратный вызов»).
   * Нет — поля в запросе нет, задачу ведёт только опрос.
   */
  callbackUrl?: string;
};

/** Синхронный текст (Claude Haiku по умолчанию). При перегрузке kie — повторы и запасная модель. */
export async function generateText(request: Omit<TextRequest, "action">, options: GenerateTextOptions = {}): Promise<TextResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return mockText(request);
  const clock = options.clock ?? realClock;
  const primary = request.model ?? GATEWAY_MODELS.text[0];
  // поле images уходит в шлюз, только если картинки есть: чат, боты и проверка без картинок — как раньше
  const { images: rawImages, ...rest } = request;
  const images = textImages(rawImages);
  const fields = images.length ? { ...rest, images } : rest;
  const models = textChain(primary, images.length > 0);
  const attempts = Math.min(models.length, options.maxAttempts ?? models.length);
  return withRetries<TextResult>(
    RETRY_BUDGET_MS.text,
    attempts,
    async (i, timeoutMs) => {
      const res = await post(config, { action: "text", ...fields, model: models[i] }, Math.min(TIMEOUT_MS.text, timeoutMs, options.attemptTimeoutMs ?? TIMEOUT_MS.text), false);
      if (!res.ok) return res;
      const body = res.body;
      if (body.ok !== true || typeof body.text !== "string") {
        const failed = failure(body, res.status);
        // «Cannot download image», отказ шлюза «images: …»: та же картинка не пройдёт и у другой модели
        return images.length && IMAGE_FAILURE_TEXT.test(failed.error) ? { ...failed, imagesRejected: true } : failed;
      }
      return { ok: true, text: body.text, model: str(body.model) ?? models[i], credits: num(body.credits) };
    },
    clock,
  );
}

/** Создать задачу (картинка, видео, движение, говорящая голова, озвучка, музыка). */
export async function createTask(request: TaskRequest, options: CreateTaskOptions = {}): Promise<CreateTaskResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return mockCreate(request);
  const clock = options.clock ?? realClock;
  const payload: Record<string, unknown> = {
    ...request,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
  };
  return withRetries<CreateTaskResult>(
    RETRY_BUDGET_MS.create,
    4,
    async (_i, timeoutMs) => {
      const sentAt = clock.now();
      const res = await post(config, payload, Math.min(TIMEOUT_MS.create, timeoutMs), true);
      if (!res.ok) return res;
      const body = res.body;
      if (body.ok !== true || typeof body.taskId !== "string" || !body.taskId) {
        const failed = failure(body, res.status);
        const n8nCrashedWaiting = !("ok" in body) && res.status >= 500 && clock.now() - sentAt >= UNCERTAIN_AFTER_MS;
        return body.uncertain === true || n8nCrashedWaiting ? { ...failed, uncertain: true } : failed;
      }
      return { ok: true, taskId: body.taskId, model: str(body.model), state: str(body.state) ?? "queued" };
    },
    clock,
  );
}

/** Статус задачи. done = true при state success или fail. */
export async function getTaskStatus(taskId: string): Promise<TaskStatusResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return mockStatus(taskId);
  const res = await post(config, { action: "status", taskId }, TIMEOUT_MS.status, false);
  if (!res.ok) return res;
  const body = res.body;
  if (body.ok !== true || typeof body.state !== "string") return failure(body, res.status);
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : [];
  return {
    ok: true,
    taskId: str(body.taskId) ?? taskId,
    state: body.state,
    done: body.done === true || body.state === "success" || body.state === "fail",
    urls,
    lastFrame: str(body.lastFrame),
    credits: num(body.credits),
    error: str(body.error),
    progress: num(body.progress),
  };
}

/** Баланс кредитов kie (для админа). */
export async function getGatewayBalance(): Promise<BalanceResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return { ok: true, credits: null };
  const res = await post(config, { action: "balance" }, TIMEOUT_MS.balance, false);
  if (!res.ok) return res;
  if (res.body.ok !== true) return failure(res.body, res.status);
  return { ok: true, credits: num(res.body.credits) };
}

// ---------- скачивание результатов (защита от SSRF) ----------

/** Хосты, с которых можно скачивать результаты kie. Единственное место со списком. */
export const KIE_RESULT_HOSTS = ["aiquickdraw.com", "redpandaai.co"] as const;

/**
 * Больше бакет media не примет (50 МиБ, media-refs.ts MEDIA_FILE_MAX_BYTES): такой файл не качаем.
 * Content-Length больше лимита — too_large сразу, без скачивания; звёзды возвращаются тем же опросом.
 */
export const MAX_RESULT_BYTES = MEDIA_FILE_MAX_BYTES;

const RESULT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
} as const;
export type ResultContentType = keyof typeof RESULT_TYPES;

export function isAllowedResultUrl(value: string): boolean {
  if (value.startsWith("mock://")) return isMockMode();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return KIE_RESULT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; contentType: ResultContentType; ext: string }
  | { ok: false; error: "host_not_allowed" | "too_large" | "bad_type" | "download_failed" };

/** Один хоп скачивания ждёт не дольше этого (и не дольше общего срока deadline). */
const DOWNLOAD_HOP_TIMEOUT_MS = 60_000;

/**
 * Скачать файл результата: только https с доменов kie (редиректы проверяются так же),
 * не больше maxBytes, тип — по первым байтам файла, а не по заголовку.
 * options.deadline (Date.now()) — общий срок на все хопы и чтение тела: к нему скачивание
 * обрывается с download_failed (повтор — по правилам опроса), а после него не начинается
 * (аудит № 21: сохранение должно уложиться в 60 с функции). Без deadline — как раньше.
 * В mock-режиме ссылки mock://… отдают встроенные файлы-заглушки.
 */
export async function downloadResult(
  value: string,
  maxBytes = MAX_RESULT_BYTES,
  options: { deadline?: number } = {},
): Promise<DownloadResult> {
  if (value.startsWith("mock://")) {
    if (!isMockMode()) return { ok: false, error: "host_not_allowed" };
    const kind = (value.slice("mock://".length).split("/")[0] || "image") as MockMediaKind;
    const media = mockMedia(["image", "video", "audio"].includes(kind) ? kind : "image");
    return { ok: true, bytes: media.bytes, contentType: media.contentType as ResultContentType, ext: media.ext };
  }

  let current = value;
  for (let hop = 0; hop < 3; hop++) {
    if (!isAllowedResultUrl(current)) return { ok: false, error: "host_not_allowed" };
    // сигнал действует и на чтение тела ниже: зависшая отдача файла тоже обрывается к сроку
    const signal = deadlineSignal(options.deadline, DOWNLOAD_HOP_TIMEOUT_MS);
    if (!signal) return { ok: false, error: "download_failed" };
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", signal, cache: "no-store" });
    } catch {
      return { ok: false, error: "download_failed" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: "download_failed" };
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) return { ok: false, error: "download_failed" };
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return { ok: false, error: "too_large" };

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch {
        return { ok: false, error: "download_failed" };
      }
      const { done, value: chunk } = step;
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const contentType = sniffContentType(bytes);
    if (!contentType) return { ok: false, error: "bad_type" };
    return { ok: true, bytes, contentType, ext: RESULT_TYPES[contentType] };
  }
  return { ok: false, error: "download_failed" };
}

function sniffContentType(b: Uint8Array): ResultContentType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    return brand.startsWith("M4A") ? "audio/mp4" : "video/mp4";
  }
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

// ---------- транспорт ----------

type RawBody = Record<string, unknown>;

async function post(
  config: { url: string; key: string },
  body: Record<string, unknown>,
  timeoutMs: number,
  createsTask: boolean,
): Promise<{ ok: true; status: number; body: RawBody } | GatewayFailure> {
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-iistart-key": config.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    // запрос мог дойти до шлюза: для создания задачи результат неизвестен
    return {
      ok: false,
      error: timedOut ? "gateway_timeout" : "gateway_unreachable",
      uncertain: createsTask && timedOut,
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      error: "gateway_bad_response",
      httpStatus: response.status,
      uncertain: createsTask && response.ok,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "gateway_bad_response", httpStatus: response.status, uncertain: createsTask && response.ok };
  }
  return { ok: true, status: response.status, body: parsed as RawBody };
}

function failure(body: RawBody, status: number): GatewayFailure {
  const httpStatus = num(body.httpStatus) ?? status;
  const result: GatewayFailure = { ok: false, error: (str(body.error) ?? "gateway_bad_response").slice(0, 300), httpStatus };
  const kieCode = intCode(body.kieCode);
  if (kieCode !== null) result.kieCode = kieCode;
  return result;
}

/** Код kie: число или строка из цифр ("402"); остальное — нет кода. */
function intCode(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,4}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------- Mock-режим ----------
//
// taskId вида mock.<action>.<время создания в мс>.<случайное>. Статус «generating», пока не прошло
// MOCK_DELAY_MS, потом success со ссылками mock://image|video|audio/… (их понимает downloadResult).
// Если в промпте есть «[[mock-fail]]», задача завершится с ошибкой — так проверяется возврат звёзд.

const MOCK_DELAY_MS: Record<GatewayTaskAction, number> = {
  image: 3_000,
  image_edit: 3_000,
  video: 8_000,
  motion: 8_000,
  lipsync: 8_000,
  voice: 2_000,
  music: 5_000,
};

const MOCK_KIND: Record<GatewayTaskAction, MockMediaKind> = {
  image: "image",
  image_edit: "image",
  video: "video",
  motion: "video",
  lipsync: "video",
  voice: "audio",
  music: "audio",
};

function mockText(request: Omit<TextRequest, "action">): TextResult {
  if (request.prompt.includes("[[mock-fail]]")) return { ok: false, error: "mock: text generation failed", httpStatus: 502 };
  const topic = request.prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    ok: true,
    model: request.model ?? GATEWAY_MODELS.text[0],
    credits: 0,
    text:
      "Тестовый ответ: шлюз не подключён, модель не вызывалась.\n\n" +
      `Запрос: «${topic}${request.prompt.length > 120 ? "…" : ""}»\n\n` +
      "Когда платформу подключат к шлюзу, здесь будет настоящий ответ.",
  };
}

function mockCreate(request: TaskRequest): CreateTaskResult {
  const prompt = "prompt" in request ? (request.prompt ?? "") : "text" in request ? request.text : "";
  const status = prompt.includes("[[mock-fail]]") ? "mockfail" : "mock";
  const taskId = `${status}.${request.action}.${Date.now()}.${randomBytes(4).toString("hex")}`;
  return { ok: true, taskId, model: request.model ?? GATEWAY_MODELS[request.action][0], state: "queued" };
}

function mockStatus(taskId: string): TaskStatusResult {
  const [kind, action, createdAt] = taskId.split(".");
  if ((kind !== "mock" && kind !== "mockfail") || !(action in MOCK_DELAY_MS)) {
    return { ok: false, error: "mock: unknown task", httpStatus: 404 };
  }
  const taskAction = action as GatewayTaskAction;
  const ready = Date.now() - Number(createdAt) >= MOCK_DELAY_MS[taskAction];
  if (!ready) return { ok: true, taskId, state: "generating", done: false, urls: [], credits: null, progress: null };
  if (kind === "mockfail") {
    return { ok: true, taskId, state: "fail", done: true, urls: [], credits: 0, error: "mock: generation failed" };
  }
  const media = MOCK_KIND[taskAction];
  const urls = taskAction === "music" ? [`mock://${media}/1`, `mock://${media}/2`] : [`mock://${media}/1`];
  return { ok: true, taskId, state: "success", done: true, urls, credits: 0 };
}
