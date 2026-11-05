import "server-only";
import { randomBytes } from "node:crypto";
import { gatewayConfig } from "@/lib/server/env";
import { mockMedia, type MockMediaKind } from "@/lib/server/mock-media";

/*
  Клиент шлюза kie в n8n (контракт — docs/kie-gateway.md).
  POST KIE_GATEWAY_URL, заголовок x-iistart-key, тело { action, ... }.
  Ключа kie на Vercel нет. Если KIE_GATEWAY_URL не задан — mock-режим: сеть не трогаем,
  отвечаем заглушками той же формы (см. «Mock-режим» внизу).

  Ответы шлюза:
    text            → { ok, text, credits }
    image … music   → { ok, taskId, state: 'queued' }
    status          → { ok, state, done, urls[], credits, error, lastFrame }
    balance         → { ok, credits }
  Ошибка → { ok: false, error }. Для ошибок сети и таймаутов error — наш код
  (gateway_unreachable, gateway_timeout, gateway_bad_response).
*/

// ---------- модели (белый список шлюза; первая — по умолчанию) ----------

export const GATEWAY_MODELS = {
  text: ["claude-haiku-5-5", "gpt-6-luna", "claude-sonnet-5-5"],
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
  voice: ["google/gemini-3-8-flash-tts"],
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
  /** манера речи */
  style?: string;
  /** голос, по умолчанию Kore */
  voice?: string;
};
export type MusicRequest = {
  action: "music";
  model?: ModelFor<"music">;
  prompt: string;
  instrumental?: boolean;
  lyrics?: string;
  title?: string;
  /** 10–60 с */
  duration?: number;
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
  /**
   * true — неизвестно, создана ли задача у kie (таймаут или обрыв после отправки).
   * Повторять такой запрос автоматически нельзя: kie может списать дважды.
   */
  uncertain?: boolean;
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

// Шлюз ждёт kie не дольше 40 с (POST) и 12 с (GET): платформа ждёт дольше, чтобы не вернуть
// звёзды за задачу, которую kie всё-таки создал. Функция живёт до 60 с (maxDuration).
const TIMEOUT_MS = { text: 50_000, create: 45_000, status: 15_000, balance: 10_000 };

// ---------- публичное API ----------

export function isMockMode(): boolean {
  return gatewayConfig().mode === "mock";
}

/*
  kie иногда перегружен: отвечает 502/503/429 «Resources are tight, please try again later».
  Такой отказ приходит быстро и задачу не создаёт, поэтому повторяем сами: два раза с паузой,
  а для текста Haiku последней попыткой берём запасную модель другого поставщика (GPT, проверена).
  Таймаут и «неизвестно, создана ли задача» не повторяем: время кончилось или kie мог списать.
*/
const RETRY_DELAYS_MS = [1500, 3000];
/** Вся попытка с повторами укладывается в функцию (maxDuration 60 с) с запасом на базу. */
const RETRY_BUDGET_MS = { text: 50_000, create: 45_000 };
const TEXT_FALLBACK_MODEL: ModelFor<"text"> = "gpt-6-luna";

/** Временный отказ kie или шлюза: можно повторить. */
export function isTransientFailure(result: GatewayFailure): boolean {
  if (result.uncertain || result.error === "gateway_timeout") return false;
  if (result.error === "gateway_unreachable") return true;
  const status = result.httpStatus ?? 0;
  if (status === 429 || status >= 500) return true;
  return /resources are tight|try again later|overload|capacity|too many requests|busy/i.test(result.error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повторы: attempt(i, timeoutMs) вызывается, пока ответ временный и хватает времени. */
async function withRetries<T extends { ok: true } | GatewayFailure>(
  budgetMs: number,
  attempts: number,
  attempt: (index: number, timeoutMs: number) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let result = await attempt(0, budgetMs);
  for (let i = 1; i < attempts; i++) {
    if (result.ok || !isTransientFailure(result)) return result;
    const delay = RETRY_DELAYS_MS[i - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const left = budgetMs - (Date.now() - started) - delay;
    if (left < 10_000) return result;
    await sleep(delay);
    result = await attempt(i, left);
  }
  return result;
}

/** Синхронный текст (Claude Haiku по умолчанию). При перегрузке kie — повторы и запасная модель. */
export async function generateText(request: Omit<TextRequest, "action">): Promise<TextResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return mockText(request);
  const primary = request.model ?? GATEWAY_MODELS.text[0];
  const models: ModelFor<"text">[] =
    primary === "claude-haiku-5-5" ? [primary, primary, TEXT_FALLBACK_MODEL] : [primary, primary, primary];
  return withRetries<TextResult>(RETRY_BUDGET_MS.text, models.length, async (i, timeoutMs) => {
    const res = await post(config, { action: "text", ...request, model: models[i] }, Math.min(TIMEOUT_MS.text, timeoutMs), false);
    if (!res.ok) return res;
    const body = res.body;
    if (body.ok !== true || typeof body.text !== "string") return failure(body, res.status);
    return { ok: true, text: body.text, model: str(body.model) ?? models[i], credits: num(body.credits) };
  });
}

/** Создать задачу (картинка, видео, движение, говорящая голова, озвучка, музыка). */
export async function createTask(request: TaskRequest): Promise<CreateTaskResult> {
  const config = gatewayConfig();
  if (config.mode === "mock") return mockCreate(request);
  return withRetries<CreateTaskResult>(RETRY_BUDGET_MS.create, 3, async (_i, timeoutMs) => {
    const res = await post(config, request as unknown as Record<string, unknown>, Math.min(TIMEOUT_MS.create, timeoutMs), true);
    if (!res.ok) return res;
    const body = res.body;
    if (body.ok !== true || typeof body.taskId !== "string" || !body.taskId) return failure(body, res.status);
    return { ok: true, taskId: body.taskId, model: str(body.model), state: str(body.state) ?? "queued" };
  });
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

export const MAX_RESULT_BYTES = 100 * 1024 * 1024;

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

/**
 * Скачать файл результата: только https с доменов kie (редиректы проверяются так же),
 * не больше maxBytes, тип — по первым байтам файла, а не по заголовку.
 * В mock-режиме ссылки mock://… отдают встроенные файлы-заглушки.
 */
export async function downloadResult(value: string, maxBytes = MAX_RESULT_BYTES): Promise<DownloadResult> {
  if (value.startsWith("mock://")) {
    if (!isMockMode()) return { ok: false, error: "host_not_allowed" };
    const kind = (value.slice("mock://".length).split("/")[0] || "image") as MockMediaKind;
    const media = mockMedia(["image", "video", "audio"].includes(kind) ? kind : "image");
    return { ok: true, bytes: media.bytes, contentType: media.contentType as ResultContentType, ext: media.ext };
  }

  let current = value;
  for (let hop = 0; hop < 3; hop++) {
    if (!isAllowedResultUrl(current)) return { ok: false, error: "host_not_allowed" };
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(60_000), cache: "no-store" });
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
      const { done, value: chunk } = await reader.read();
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
  return { ok: false, error: (str(body.error) ?? "gateway_bad_response").slice(0, 300), httpStatus };
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
