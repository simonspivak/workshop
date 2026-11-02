import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { FONTS_DIR, FONT_FILE, OUTPUT, type EncodeOptions } from "./args";
import { CLASSES_JS, CORE_JS, CORE_WASM, FFMPEG_CORE_VERSION, FONT_URL, type CoreFile } from "./core-files";

type FFmpegModule = { FFmpeg: new () => FFmpeg };
import { MontageError, runPipeline, type MontageBackend, type PipelineJob, type PipelineProgress } from "./pipeline";

/*
  Автомонтаж в браузере: ffmpeg.wasm (однопоточное ядро, без COOP/COEP и SharedArrayBuffer).

  Ядро (32 МБ) лежит у нас в public/ffmpeg. Качаем его сами — так виден честный прогресс
  загрузки — и отдаём воркеру как blob:. Если своего файла нет (404, обрыв), берём ту же версию
  с jsDelivr и принимаем только при совпадении sha256 (core-files.ts). Воркер — наш
  public/ffmpeg/worker.js (копия из @ffmpeg/ffmpeg), бандлер его не трогает.

  Отмена: воркер ffmpeg считает синхронно, прервать команду можно только terminate().
  После отмены ядро загружается заново из уже скачанных blob: (без повторной загрузки).

  Только для клиентских компонентов.
*/

export type CoreLoadProgress = { loaded: number; total: number; source: "self" | "cdn" };

export type EngineProgress =
  | { phase: "core"; core: CoreLoadProgress }
  | { phase: "pipeline"; step: PipelineProgress; ratio: number; etaSeconds: number | null };

export type MontageOutput = { blob: Blob; duration: number; frames: number; elapsedMs: number };

// ---------- поддержка ----------

/** Есть ли всё нужное: WebAssembly, модульные воркеры, Blob URL. */
export function montageSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function") return false;
  if (typeof Worker !== "function" || typeof URL.createObjectURL !== "function") return false;
  // Модульные воркеры: браузер читает options.type, только если поддерживает их
  let moduleWorkers = false;
  const url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
  try {
    const options = {
      get type(): WorkerType {
        moduleWorkers = true;
        return "module";
      },
    };
    new Worker(url, options).terminate();
  } catch {
    // не важно: нужен только факт чтения options.type
  } finally {
    URL.revokeObjectURL(url);
  }
  return moduleWorkers;
}

/** Телефон или планшет: ставим пресет x264 побыстрее. */
export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function defaultEncode(): EncodeOptions {
  return { preset: isTouchDevice() ? "superfast" : "veryfast", crf: 23 };
}

/**
 * Скорость кодирования до первого замера, кадров в секунду, с запасом, чтобы не обещать лишнего.
 * Для сравнения: то же ядро в Node на сервере — ~45 кадров/с (npm run test:montage).
 */
export const ASSUMED_FPS = { desktop: 25, phone: 8 } as const;

export function assumedFps(): number {
  return isTouchDevice() ? ASSUMED_FPS.phone : ASSUMED_FPS.desktop;
}

// ---------- ядро ----------

type CoreUrls = { coreURL: string; wasmURL: string; source: "self" | "cdn" };

let coreUrls: CoreUrls | null = null;
let instance: FFmpeg | null = null;
let logSink: string[] | null = null;
let timeSink: ((seconds: number) => void) | null = null;

async function fetchBytes(
  url: string,
  signal: AbortSignal | undefined,
  onBytes?: (loaded: number, total: number) => void,
  expected = 0,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || expected;
  if (!response.body || !onBytes) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded, Math.max(total, loaded));
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadCoreFrom(
  source: "self" | "cdn",
  signal: AbortSignal | undefined,
  onProgress: (p: CoreLoadProgress) => void,
): Promise<CoreUrls> {
  const url = (file: CoreFile) =>
    source === "self" ? `/${file.path}?v=${FFMPEG_CORE_VERSION}` : (file.cdn as string);
  const total = CORE_JS.bytes + CORE_WASM.bytes;
  const js = await fetchBytes(url(CORE_JS), signal);
  const wasm = await fetchBytes(url(CORE_WASM), signal, (loaded) => onProgress({ loaded: CORE_JS.bytes + loaded, total, source }), CORE_WASM.bytes);
  if (source === "cdn") {
    // чужой сервер: принимаем только байт в байт ту же сборку
    const [jsHash, wasmHash] = await Promise.all([sha256(js), sha256(wasm)]);
    if (jsHash !== CORE_JS.sha256 || wasmHash !== CORE_WASM.sha256) throw new Error("core checksum mismatch");
  }
  return {
    coreURL: URL.createObjectURL(new Blob([js], { type: "text/javascript" })),
    wasmURL: URL.createObjectURL(new Blob([wasm], { type: "application/wasm" })),
    source,
  };
}

async function loadCore(signal: AbortSignal | undefined, onProgress: (p: CoreLoadProgress) => void): Promise<CoreUrls> {
  if (coreUrls) return coreUrls;
  try {
    coreUrls = await loadCoreFrom("self", signal, onProgress);
  } catch (error) {
    if (signal?.aborted) throw error;
    coreUrls = await loadCoreFrom("cdn", signal, onProgress);
  }
  return coreUrls;
}

async function getFFmpeg(signal: AbortSignal | undefined, onProgress: (p: CoreLoadProgress) => void): Promise<FFmpeg> {
  if (instance?.loaded) return instance;
  const core = await loadCore(signal, onProgress);
  // мимо бандлера (см. core-files.ts); типы — из пакета @ffmpeg/ffmpeg той же версии
  const classesUrl = `/${CLASSES_JS.path}`;
  const { FFmpeg } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ classesUrl)) as FFmpegModule;
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    logSink?.push(message);
  });
  ffmpeg.on("progress", ({ time }) => {
    // time — микросекунды готового выхода текущей команды
    if (Number.isFinite(time) && time >= 0) timeSink?.(time / 1e6);
  });
  try {
    // воркер classes.js берёт рядом с собой: /ffmpeg/worker.js
    await ffmpeg.load({ coreURL: core.coreURL, wasmURL: core.wasmURL }, { signal });
    const font = await fetchBytes(FONT_URL, signal);
    await ffmpeg.createDir(FONTS_DIR);
    await ffmpeg.writeFile(`${FONTS_DIR}/${FONT_FILE}`, font);
  } catch (error) {
    ffmpeg.terminate();
    throw error;
  }
  instance = ffmpeg;
  return ffmpeg;
}

/**
 * Остановить воркер ffmpeg (отмена или уход со страницы). Скачанное ядро остаётся в памяти,
 * чтобы следующий монтаж не качал его заново; releaseCore — отпустить и его.
 */
export function terminateMontage(options: { releaseCore?: boolean } = {}): void {
  instance?.terminate();
  instance = null;
  logSink = null;
  timeSink = null;
  if (options.releaseCore && coreUrls) {
    URL.revokeObjectURL(coreUrls.coreURL);
    URL.revokeObjectURL(coreUrls.wasmURL);
    coreUrls = null;
  }
}

function backendFor(ffmpeg: FFmpeg): MontageBackend {
  return {
    async write(name, data) {
      await ffmpeg.writeFile(name, data);
    },
    async read(name) {
      const data = await ffmpeg.readFile(name);
      if (typeof data === "string") throw new Error("unexpected text file");
      return data;
    },
    async remove(name) {
      await ffmpeg.deleteFile(name);
    },
    async exec(args, onTime) {
      logSink = [];
      timeSink = onTime ?? null;
      try {
        const code = await ffmpeg.exec(args);
        return { code, log: logSink.join("\n") };
      } finally {
        logSink = null;
        timeSink = null;
      }
    },
  };
}

/** Исходник по подписанной ссылке Storage (CORS у Supabase открыт). */
async function loadMedia(source: string, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const data = await fetchBytes(source, signal);
  if (data.byteLength > 150 * 1024 * 1024) throw new Error("file too large");
  return data;
}

// ---------- оценка ----------

/**
 * Доля готовности и честная оценка остатка. До первого замера — осторожная скорость
 * (assumedFps), потом — реальная скорость кодирования на этом устройстве.
 */
export function estimate(
  step: PipelineProgress,
  plannedFrames: number,
  segmentStartedAt: number | null,
  now: number,
  fallbackFps: number,
): { ratio: number; etaSeconds: number | null } {
  const done = step.framesDone + step.segmentDone;
  const total = Math.max(plannedFrames, done, 1);
  const elapsed = step.encodeSeconds + (segmentStartedAt ? (now - segmentStartedAt) / 1000 : 0);
  const fps = done >= OUTPUT.fps && elapsed > 0.5 ? done / elapsed : fallbackFps;
  // финал: склейка без перекодирования видео и звук в AAC — примерно 5 % времени кадров
  const finalSeconds = 1 + (total / fps) * 0.05;
  if (step.stage === "final") return { ratio: 0.97, etaSeconds: Math.ceil(finalSeconds) };
  const remaining = Math.max(0, total - done) / fps + finalSeconds;
  return { ratio: Math.min(0.95, (done / total) * 0.95), etaSeconds: Math.ceil(remaining) };
}

// ---------- запуск ----------

export async function renderMontage(
  job: PipelineJob,
  options: { plannedFrames: number; signal?: AbortSignal; onProgress?: (p: EngineProgress) => void },
): Promise<MontageOutput> {
  const { signal, onProgress } = options;
  if (!montageSupported()) throw new MontageError("unsupported");
  const started = performance.now();
  const onAbort = () => terminateMontage();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let ffmpeg: FFmpeg;
    try {
      ffmpeg = await getFFmpeg(signal, (core) => onProgress?.({ phase: "core", core }));
    } catch (error) {
      if (signal?.aborted) throw new MontageError("cancelled");
      terminateMontage();
      throw new MontageError("core_failed", error instanceof Error ? error.message : String(error));
    }

    const fallbackFps = assumedFps();
    let segmentStartedAt: number | null = null;
    let lastStage: PipelineProgress["stage"] | null = null;
    let lastFramesDone = -1;
    const result = await runPipeline(backendFor(ffmpeg), loadMedia, job, {
      signal,
      now: () => performance.now(),
      onProgress: (step) => {
        const now = performance.now();
        // начало кодирования сегмента — с первой отметки рендера после скачивания
        if (step.stage !== lastStage || step.framesDone !== lastFramesDone) {
          segmentStartedAt = step.stage === "render" || step.stage === "title" ? now : null;
          lastStage = step.stage;
          lastFramesDone = step.framesDone;
        }
        const { ratio, etaSeconds } = estimate(step, options.plannedFrames, segmentStartedAt, now, fallbackFps);
        onProgress?.({ phase: "pipeline", step, ratio, etaSeconds });
      },
    });
    const bytes = new Uint8Array(result.data);
    return {
      blob: new Blob([bytes], { type: "video/mp4" }),
      duration: result.plan.duration,
      frames: result.plan.frames,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    if (signal?.aborted) throw new MontageError("cancelled");
    if (error instanceof MontageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // ядро упало (нехватка памяти и т. п.) — следующий запуск начнёт с чистого
    terminateMontage();
    throw new MontageError(/memory|OOM|Aborted/i.test(message) ? "out_of_memory" : "ffmpeg_failed", message);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
