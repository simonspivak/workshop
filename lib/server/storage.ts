import "server-only";
import { isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import { classifyReferences, mediaKindOfPath, type ReferenceInput, type ReferenceSlot } from "@/lib/server/media-refs";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { MediaKind } from "@/lib/platform/generation-types";

/*
  Приватный бакет media: загрузка результатов и подписанные ссылки. Пишет и подписывает только
  сервер (admin-клиент) и только после проверки прав в DAL.
  Ссылки живут час: этого хватает и на просмотр, и шлюзу, чтобы забрать референс.
  Библиотека курса (драйверы движения для motion) — папка library/motion/ в том же бакете,
  файлы кладёт админ через Supabase → Storage.
*/

export const SIGNED_URL_TTL_SEC = 60 * 60;
export const MOTION_LIBRARY_FOLDER = "library/motion";

/** Подписанные ссылки на файлы. Путь, который не удалось подписать (нет файла), в ответ не попадает. */
export async function signMediaPaths(paths: string[], ttlSec = SIGNED_URL_TTL_SEC): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const storage = createAdminClient().storage.from(MEDIA_BUCKET);
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
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

export type UploadResult = { ok: true } | { ok: false; error: "too_large" | "upload_failed" };

export async function uploadMedia(path: string, bytes: Uint8Array, contentType: string): Promise<UploadResult> {
  const { error } = await createAdminClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: "3600" });
  if (!error) return { ok: true };
  const status = String((error as { statusCode?: string | number; status?: number }).statusCode ?? "");
  const tooLarge = status === "413" || /maximum allowed size|too large/i.test(error.message);
  console.error("storage.uploadMedia: failed", { status, tooLarge });
  return { ok: false, error: tooLarge ? "too_large" : "upload_failed" };
}

/** Файлы библиотеки курса в папке (только файлы с понятным типом). */
export async function listLibrary(folder: string): Promise<{ path: string; name: string; kind: MediaKind }[]> {
  const { data, error } = await createAdminClient()
    .storage.from(MEDIA_BUCKET)
    .list(folder, { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (error) {
    console.error("storage.listLibrary: failed", { folder });
    return [];
  }
  return (data ?? [])
    .filter((item) => item.id && !item.name.startsWith("."))
    .map((item) => ({ path: `${folder}/${item.name}`, name: item.name, kind: mediaKindOfPath(item.name) }))
    .filter((item): item is { path: string; name: string; kind: MediaKind } => item.kind !== null);
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
      .select("id, user_id, group_id, status, hidden, storage_path, extra_paths")
      .in("id", ids);
    if (error) throw new Error(`storage.resolveReferences: jobs query failed (${error.code})`);
    const byId = new Map((jobs ?? []).map((job) => [job.id, job]));
    const taughtGroups = staff ? await groupsTaughtBy(user, (jobs ?? []).map((job) => job.group_id)) : new Set<string>();

    for (const ref of jobRefs) {
      const job = byId.get(ref.jobId);
      if (!job || job.user_id !== ref.ownerId || job.status !== "done" || job.hidden) return { ok: false, error: "bad_reference" };
      if (job.storage_path !== ref.value && !job.extra_paths.includes(ref.value)) return { ok: false, error: "bad_reference" };
      const own = job.user_id === user.id;
      const sharedInGroup =
        !staff && Boolean(user.group?.shareGallery) && job.group_id !== null && job.group_id === user.group?.id;
      const teaches = staff && (user.role === "admin" || (job.group_id !== null && taughtGroups.has(job.group_id)));
      if (!own && !sharedInGroup && !teaches) return { ok: false, error: "bad_reference" };
    }
  }

  const toSign = refs.filter((ref) => ref.source !== "url").map((ref) => ref.value);
  const signed = await signMediaPaths(toSign);
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
