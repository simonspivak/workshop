import "server-only";
import { motionDriverVerdict } from "@/lib/platform/generation-types";
import { readMp4Duration, type Mp4Chunk } from "@/lib/platform/mp4-duration";

/*
  Длина видео-образца (драйвера) для переноса движения. kie (kling-2.6/motion-control) берёт кредиты
  за каждую секунду образца и отдаёт ролик той же длины, а звёзды — одна цена. Поэтому до списания
  сервер узнаёт длину образца по заголовку MP4 (moov → mvhd) и не пускает длиннее
  MOTION_DRIVER_MAX_SEC (lib/platform/generation-types.ts).

  Файл целиком не качаем: Range-запросы по подписанной ссылке Storage — первые 64 КБ, а если moov
  в конце файла — ещё 64 КБ с его начала (lib/platform/mp4-duration.ts). Каждый запрос — не дольше
  RANGE_TIMEOUT_MS. Длина кешируется в памяти инстанса по пути файла:
    • с версией файла (updated_at и размер из списка папки — его уже читает выбор образца) —
      до часа, пока версия та же;
    • без версии (проверка при запуске генерации) — DRIVER_CACHE_TTL_MS, 5 минут;
    • «длину узнать не удалось» — минуту: сбой сети не держится долго.
  Внешние ссылки ведущего сервер не открывает: их длина «неизвестна», ведущему это можно.
*/

const RANGE_TIMEOUT_MS = 4_000;
export const DRIVER_CACHE_TTL_MS = 5 * 60_000;
export const DRIVER_VERSIONED_TTL_MS = 60 * 60_000;
export const DRIVER_UNKNOWN_TTL_MS = 60_000;
const DRIVER_CACHE_MAX_ENTRIES = 500;
const LIBRARY_PARALLEL = 4;

// ---------- чтение куска файла ----------

/**
 * До length байт с offset по ссылке. 206 — полный размер из Content-Range; если сервер Range
 * не понял и отдаёт файл целиком (200), читаем только начало и обрываем. null — не вышло.
 */
export async function fetchRange(url: string, offset: number, length: number, timeoutMs = RANGE_TIMEOUT_MS): Promise<Mp4Chunk | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  let total: number | null = null;
  if (response.status === 206) {
    const range = /^bytes\s+(\d+)-\d+\/(\d+|\*)\s*$/i.exec(response.headers.get("content-range") ?? "");
    if (!range || Number(range[1]) !== offset) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    total = range[2] === "*" ? null : Number(range[2]);
  } else if (response.status === 200 && offset === 0) {
    const declared = Number(response.headers.get("content-length"));
    total = Number.isFinite(declared) && declared > 0 ? declared : null;
  } else {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;

  const out = new Uint8Array(length);
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (size < length) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, length - size);
      out.set(value.subarray(0, take), size);
      size += take;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: out.subarray(0, size), total };
}

/** Длина MP4 по ссылке, секунды. null — не MP4, нет moov, сеть. */
export async function measureMp4Seconds(url: string): Promise<number | null> {
  const result = await readMp4Duration((offset, length) => fetchRange(url, offset, length));
  if (result.ok) return result.seconds;
  // ссылку не пишем: в ней токен Storage
  console.error("motionDriver: duration unknown", { reason: result.reason, reads: result.reads, bytes: result.bytesRead });
  return null;
}

// ---------- кеш длин ----------

type Entry = { seconds: number | null; version: string | null; at: number };

export type DriverDurationCache = {
  /** Длина файла path (ссылка url — чтобы измерить). version — updated_at и размер файла, если известны. */
  get(path: string, url: string, version?: string | null): Promise<number | null>;
  forget(path: string): void;
  size(): number;
};

export function createDriverDurationCache(options: {
  measure: (url: string) => Promise<number | null>;
  now?: () => number;
  maxEntries?: number;
}): DriverDurationCache {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DRIVER_CACHE_MAX_ENTRIES;
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<number | null>>();

  const fresh = (entry: Entry, version: string | null) => {
    const age = now() - entry.at;
    if (entry.seconds === null) return age < DRIVER_UNKNOWN_TTL_MS && (!version || entry.version === version);
    if (version) return entry.version === version && age < DRIVER_VERSIONED_TTL_MS;
    return age < DRIVER_CACHE_TTL_MS;
  };

  return {
    async get(path, url, version = null) {
      const entry = entries.get(path);
      if (entry && fresh(entry, version)) return entry.seconds;
      const key = `${path}\n${version ?? ""}`;
      const running = inflight.get(key);
      if (running) return running;
      const job = options
        .measure(url)
        .catch(() => null)
        .then((seconds) => {
          entries.delete(path);
          entries.set(path, { seconds, version, at: now() });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
          return seconds;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, job);
      return job;
    },
    forget(path) {
      entries.delete(path);
    },
    size() {
      return entries.size;
    },
  };
}

const durations = createDriverDurationCache({ measure: measureMp4Seconds });

// ---------- проверки ----------

export type MotionDriverError = "motion_too_long" | "motion_unchecked";

/**
 * Проверка образца при запуске переноса движения — до списания звёзд и до шлюза.
 * path — путь в бакете media (права уже проверил resolveReferences) или https-ссылка ведущего;
 * url — подписанная ссылка на этот файл.
 */
export async function checkMotionDriver(input: {
  staff: boolean;
  path: string;
  url: string;
}): Promise<{ ok: true; seconds: number | null } | { ok: false; error: MotionDriverError; seconds: number | null }> {
  const external = !input.path || input.path.startsWith("https://");
  const seconds = external || !input.url ? null : await durations.get(input.path, input.url);
  const verdict = motionDriverVerdict(seconds, input.staff);
  if (verdict === "too_long") return { ok: false, error: "motion_too_long", seconds };
  if (verdict === "unknown") return { ok: false, error: "motion_unchecked", seconds };
  return { ok: true, seconds };
}

/** Длины образцов библиотеки для плиток выбора (по несколько параллельно). */
export async function libraryDriverSeconds(
  files: { path: string; url: string; version: string | null }[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      result.set(file.path, await durations.get(file.path, file.url, file.version));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIBRARY_PARALLEL, files.length) }, worker));
  return result;
}
