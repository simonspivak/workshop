import "server-only";
import { isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import {
  classifyReferences,
  isLibraryPath,
  MEDIA_FILE_MAX_BYTES,
  mediaKindOfPath,
  parseJobMediaPath,
  type ReferenceInput,
  type ReferenceSlot,
} from "@/lib/server/media-refs";
import { MIN_STEP_MS, msLeft } from "@/lib/server/deadline";
import { createSignedUrlCache, type SignedEntry } from "@/lib/server/signed-url-cache";
import { createDriverDurationCache, fetchRange } from "@/lib/server/motion-driver";
import { createAdminClient, createAdminClientUntil } from "@/lib/server/supabase/admin";
import { lipsyncAudioVerdict, STUDENT_LIPSYNC_MAX_SEC, type MediaKind } from "@/lib/platform/generation-types";

/*
  Приватный бакет media: загрузка результатов и подписанные ссылки. Пишет и подписывает только
  сервер (admin-клиент) и только после проверки прав в DAL.
  Ссылки живут час: этого хватает и на просмотр, и шлюзу, чтобы забрать референс.
  Одна и та же ссылка отдаётся повторно до 45 минут (кеш инстанса), чтобы браузер брал файл из кеша.
  Библиотека курса (драйверы движения для motion) — папка library/motion/ в том же бакете,
  файлы кладёт админ через Supabase → Storage.
*/

export const SIGNED_URL_TTL_SEC = 60 * 60;
export const MOTION_LIBRARY_FOLDER = "library/motion";

// Ссылки на час переиспользуются, пока живут ещё 15+ минут (lib/server/signed-url-cache.ts)
const signedUrls = createSignedUrlCache({ ttlSec: SIGNED_URL_TTL_SEC });

async function signFresh(paths: string[], ttlSec: number): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const storage = createAdminClient().storage.from(MEDIA_BUCKET);
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data, error } = await storage.createSignedUrls(chunk, ttlSec);
    if (error) {
      console.error("storage.signMediaPaths: failed", { status: (error as { status?: number }).status });
      continue;
    }
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl && !entry.error) result.set(entry.path, entry.signedUrl);
    }
  }
  return result;
}

export type SignOptions = {
  /** подписать заново, мимо кеша: ссылка уходит шлюзу и должна жить полный час */
  fresh?: boolean;
};

/**
 * Подписанные ссылки со сроком действия. Подписывает только то, что попросили: права на пути
 * проверяет вызывающий код ДО этого вызова, кеш права не проверяет. Ссылки на час берутся
 * из кеша инстанса; короткие (ttlSec ≠ часу, например проверка файла сервером) и fresh
 * подписываются каждый раз заново.
 */
export async function signMediaPathsWithExpiry(
  paths: string[],
  ttlSec = SIGNED_URL_TTL_SEC,
  options: SignOptions = {},
): Promise<Map<string, SignedEntry>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map();
  if (ttlSec === SIGNED_URL_TTL_SEC && !options.fresh) return signedUrls.sign(unique, signFresh);
  const signedAt = Date.now();
  const fresh = await signFresh(unique, ttlSec);
  return new Map([...fresh].map(([path, url]) => [path, { url, expiresAt: signedAt + ttlSec * 1000 }]));
}

/** Подписанные ссылки на файлы. Путь, который не удалось подписать (нет файла), в ответ не попадает. */
export async function signMediaPaths(
  paths: string[],
  ttlSec = SIGNED_URL_TTL_SEC,
  options: SignOptions = {},
): Promise<Map<string, string>> {
  const signed = await signMediaPathsWithExpiry(paths, ttlSec, options);
  return new Map([...signed].map(([path, entry]) => [path, entry.url]));
}

/** Файл перезаписан или удалён: старую ссылку больше не отдаём. */
export function forgetSignedUrls(paths: string[]): void {
  signedUrls.forget(paths);
}

export type UploadResult = { ok: true } | { ok: false; error: "too_large" | "upload_failed" };

/**
 * Положить файл в бакет media. deadline (Date.now()) — к этому сроку загрузка обрывается
 * и считается неудачной (upload_failed): задачу потом перехватит опрос (аудит № 21).
 */
export async function uploadMedia(
  path: string,
  bytes: Uint8Array,
  contentType: string,
  options: { deadline?: number } = {},
): Promise<UploadResult> {
  if (msLeft(options.deadline) < MIN_STEP_MS) {
    console.error("storage.uploadMedia: no time left");
    return { ok: false, error: "upload_failed" };
  }
  // бакет всё равно откажет (file_size_limit): не тратим время на загрузку, звёзды вернутся сразу
  if (bytes.byteLength > MEDIA_FILE_MAX_BYTES) {
    console.error("storage.uploadMedia: too large", { bytes: bytes.byteLength });
    return { ok: false, error: "too_large" };
  }
  const client = options.deadline === undefined ? createAdminClient() : createAdminClientUntil(options.deadline);
  let error: { message: string; statusCode?: string | number } | null;
  try {
    ({ error } = await client.storage
      .from(MEDIA_BUCKET)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: "3600" }));
  } catch (cause) {
    console.error("storage.uploadMedia: threw", { aborted: cause instanceof Error && /abort|timeout/i.test(cause.name) });
    return { ok: false, error: "upload_failed" };
  }
  forgetSignedUrls([path]);
  if (!error) return { ok: true };
  const status = String(error.statusCode ?? "");
  const tooLarge = status === "413" || /maximum allowed size|too large/i.test(error.message);
  console.error("storage.uploadMedia: failed", { status, tooLarge });
  return { ok: false, error: tooLarge ? "too_large" : "upload_failed" };
}

export type LibraryFile = {
  path: string;
  name: string;
  kind: MediaKind;
  /** updated_at и размер из Storage: меняются, когда файл перезалили (ключ кеша длины образца) */
  version: string | null;
};

/** Файлы библиотеки курса в папке (только файлы с понятным типом). */
export async function listLibrary(folder: string): Promise<LibraryFile[]> {
  const { data, error } = await createAdminClient()
    .storage.from(MEDIA_BUCKET)
    .list(folder, { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (error) {
    console.error("storage.listLibrary: failed", { folder });
    return [];
  }
  return (data ?? [])
    .filter((item) => item.id && !item.name.startsWith("."))
    .map((item) => ({
      path: `${folder}/${item.name}`,
      name: item.name,
      kind: mediaKindOfPath(item.name),
      version: fileVersion(item.updated_at, (item.metadata as { size?: unknown } | null)?.size),
    }))
    .filter((item): item is LibraryFile => item.kind !== null);
}

function fileVersion(updatedAt: unknown, size: unknown): string | null {
  if (typeof updatedAt !== "string" || !updatedAt) return null;
  return `${updatedAt}|${typeof size === "number" ? size : ""}`;
}

// ---------- референсы для шлюза ----------

export type ResolvedReferences = {
  /** для шлюза: подписанные ссылки (или ссылки ведущего) */
  urls: ReferenceInput;
  /** для журнала задач: пути и ссылки как прислали, без подписей */
  stored: ReferenceInput;
};

export type ResolveError = "bad_reference" | "library_only";

/**
 * Референсы запроса → публичные ссылки для шлюза.
 * Ученик: только свои готовые и не скрытые результаты, результаты своей группы, если ведущий
 * открыл общую галерею, и библиотека курса. Ведущий: ещё результаты своих групп и любые https-ссылки.
 */
export async function resolveReferences(
  user: SessionUser,
  input: ReferenceInput,
  options: { libraryOnlyVideo: boolean },
): Promise<{ ok: true; refs: ResolvedReferences } | { ok: false; error: ResolveError }> {
  const staff = isStaff(user);
  const classified = classifyReferences(input, { staff, libraryOnlyVideo: options.libraryOnlyVideo && !staff });
  if (!classified.ok) return classified;
  const refs = classified.refs;
  if (refs.length === 0) return { ok: true, refs: { urls: {}, stored: {} } };

  const jobRefs = refs.filter((ref) => ref.source === "job");
  if (jobRefs.length) {
    const ids = [...new Set(jobRefs.map((ref) => ref.jobId))];
    const { data: jobs, error } = await createAdminClient()
      .from("jobs")
      .select("id, user_id, group_id, status, hidden, deleted_at, storage_path, extra_paths")
      .in("id", ids);
    if (error) throw new Error(`storage.resolveReferences: jobs query failed (${error.code})`);
    const byId = new Map((jobs ?? []).map((job) => [job.id, job]));
    const taughtGroups = staff ? await groupsTaughtBy(user, (jobs ?? []).map((job) => job.group_id)) : new Set<string>();

    for (const ref of jobRefs) {
      const job = byId.get(ref.jobId);
      if (!job || job.user_id !== ref.ownerId || job.status !== "done" || job.hidden || job.deleted_at) {
        return { ok: false, error: "bad_reference" };
      }
      if (job.storage_path !== ref.value && !job.extra_paths.includes(ref.value)) return { ok: false, error: "bad_reference" };
      const own = job.user_id === user.id;
      const sharedInGroup =
        !staff && Boolean(user.group?.shareGallery) && job.group_id !== null && job.group_id === user.group?.id;
      const teaches = staff && (user.role === "admin" || (job.group_id !== null && taughtGroups.has(job.group_id)));
      if (!own && !sharedInGroup && !teaches) return { ok: false, error: "bad_reference" };
    }
  }

  const toSign = refs.filter((ref) => ref.source !== "url").map((ref) => ref.value);
  // шлюзу — свежая ссылка на полный час: kie может забрать референс не сразу
  const signed = await signMediaPaths(toSign, SIGNED_URL_TTL_SEC, { fresh: true });
  const urls: ReferenceInput = {};
  const stored: ReferenceInput = {};
  for (const ref of refs) {
    const url = ref.source === "url" ? ref.value : signed.get(ref.value);
    if (!url) return { ok: false, error: "bad_reference" };
    put(urls, ref.slot, url);
    put(stored, ref.slot, ref.value);
  }
  return { ok: true, refs: { urls, stored } };
}

// ---------- озвучка для «говорящей головы» ----------

/*
  Kling AI Avatar берёт кредиты за каждую секунду аудио (до 5 минут, ≈ 8,7 кредита/с), а цена
  в звёздах одна. Поэтому ученику — только своя озвучка реплики (задача voice) не длиннее
  STUDENT_LIPSYNC_MAX_SEC (lib/platform/generation-types.ts) с допуском 0,5 с. Ведущему — без потолка.
  Длину читаем по заголовку WAV: один Range-запрос на первые 4 КБ по подписанной ссылке.
  Результат озвучки после сохранения не меняется, поэтому длина кешируется по пути файла
  (известная — час, «не узнать» — минуту; кеш — тот же, что у образцов движения).
*/

/** Если длину файла не узнать (не WAV, сбой сети): текст реплики не длиннее ≈ 14,5 знака на секунду речи. */
export const STUDENT_LIPSYNC_MAX_TEXT = Math.round(STUDENT_LIPSYNC_MAX_SEC * 14.5);
/** Сколько озвучек за один рендер страницы урока меряем для плиток (самые новые). */
export const VOICE_SECONDS_PER_RENDER = 12;
const WAV_HEAD_BYTES = 4096;
/** Версия для кеша длин: файл результата не перезаписывается, известная длина живёт час. */
const IMMUTABLE = "immutable";

/** Длительность WAV по заголовку (первые байты файла) и полному размеру. null — не WAV. */
export function wavDurationSec(head: Uint8Array, totalBytes: number | null): number | null {
  const ascii = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
  if (head.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let byteRate = 0;
  for (let at = 12; at + 8 <= head.length; ) {
    const id = ascii(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 20 <= head.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") {
      if (!byteRate) return null;
      const available = totalBytes !== null ? Math.max(0, totalBytes - (at + 8)) : size;
      const dataBytes = size > 0 && size !== 0xffffffff ? Math.min(size, available) : available;
      return dataBytes / byteRate;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Длина WAV по ссылке, секунды. null — не WAV, сеть, нет ответа. Ссылку не логируем: в ней токен. */
export async function measureWavSeconds(url: string): Promise<number | null> {
  const chunk = await fetchRange(url, 0, WAV_HEAD_BYTES);
  if (!chunk) return null;
  return wavDurationSec(chunk.bytes, chunk.total);
}

const voiceDurations = createDriverDurationCache({ measure: measureWavSeconds });

/** Длина озвучки по пути в бакете и ссылке на неё (через кеш). */
export function voiceSeconds(path: string, url: string): Promise<number | null> {
  return voiceDurations.get(path, url, IMMUTABLE);
}

/**
 * Длины озвучек для плиток выбора: не больше VOICE_SECONDS_PER_RENDER файлов (самые новые — первыми
 * в списке), по 4 параллельно; остальные — без длины (плитка доступна, решает сервер).
 */
export async function voiceSecondsFor(files: { path: string; url: string }[]): Promise<Map<string, number | null>> {
  const picked = files.slice(0, VOICE_SECONDS_PER_RENDER);
  const result = new Map<string, number | null>();
  let next = 0;
  const worker = async () => {
    while (next < picked.length) {
      const file = picked[next++];
      result.set(file.path, await voiceSeconds(file.path, file.url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, picked.length) }, worker));
  return result;
}

export type LipsyncAudioCheck =
  | { ok: true; seconds: number | null }
  | { ok: false; seconds: number | null; reason: "too_long" | "not_voice" };

/**
 * Озвучка для lipsync. path — путь в бакете (права уже проверил resolveReferences) или https-ссылка
 * ведущего; url — подписанная ссылка на этот файл. Ведущему — без потолка, длина только для журнала.
 * Ученику: библиотека курса — можно; иначе только результат задачи voice не длиннее потолка;
 * длину не узнать — правило длины текста реплики (STUDENT_LIPSYNC_MAX_TEXT).
 */
export async function checkLipsyncAudio(input: { staff: boolean; path: string; url: string }): Promise<LipsyncAudioCheck> {
  const external = !input.path || input.path.startsWith("https://");
  const measure = () => (external || !input.url ? Promise.resolve(null) : voiceSeconds(input.path, input.url));
  if (input.staff) return { ok: true, seconds: await measure() };
  if (isLibraryPath(input.path)) return { ok: true, seconds: await measure() }; // библиотеку курса кладёт админ
  const parsed = parseJobMediaPath(input.path);
  if (!parsed) return { ok: false, seconds: null, reason: "not_voice" };
  const { data, error } = await createAdminClient().from("jobs").select("action, prompt").eq("id", parsed.jobId).maybeSingle();
  if (error) throw new Error(`storage.checkLipsyncAudio failed (${error.code})`);
  if (!data || data.action !== "voice") return { ok: false, seconds: null, reason: "not_voice" };
  const seconds = await measure();
  if (seconds !== null) {
    return lipsyncAudioVerdict(seconds, false) === "ok" ? { ok: true, seconds } : { ok: false, seconds, reason: "too_long" };
  }
  if ((data.prompt ?? "").length <= STUDENT_LIPSYNC_MAX_TEXT) return { ok: true, seconds: null };
  return { ok: false, seconds: null, reason: "too_long" };
}

function put(target: ReferenceInput, slot: ReferenceSlot, value: string) {
  if (slot === "video" || slot === "audio") target[slot] = value;
  else (target[slot] ??= []).push(value);
}

async function groupsTaughtBy(user: SessionUser, groupIds: (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0 || user.role === "admin") return new Set(ids);
  const { data, error } = await createAdminClient().from("groups").select("id").in("id", ids).eq("teacher_id", user.id);
  if (error) throw new Error(`storage.groupsTaughtBy failed (${error.code})`);
  return new Set((data ?? []).map((g) => g.id));
}
