import "server-only";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { assertTeachesGroup, isUuid } from "@/lib/server/dal/teacher";
import { audit } from "@/lib/server/audit";
import { JOB_COLUMNS, toJobViews, type JobRecord } from "@/lib/server/job-progress";
import { mediaKindOfPath } from "@/lib/server/media-refs";
import { listLibrary, MOTION_LIBRARY_FOLDER, signMediaPaths } from "@/lib/server/storage";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import {
  jobActionLabels,
  type GalleryItem,
  type JobAction,
  type MediaKind,
  type MediaOption,
} from "@/lib/platform/generation-types";

/*
  Галерея (docs/platform/spec.md §3). Чтение — клиентом пользователя (RLS: своё; ведущий —
  свои группы; общая галерея группы — только готовое и не скрытое, если ведущий её открыл).
  Подписи ссылок и ники одногруппников — admin-клиентом после явной проверки.
  Текстовые ответы в галерею не попадают: они остаются в уроке.
*/

export const GALLERY_PAGE_SIZE = 24;

const ACTIONS_BY_KIND: Record<MediaKind, JobAction[]> = {
  image: ["image", "image_edit"],
  video: ["video", "motion", "lipsync", "montage"],
  audio: ["voice", "music"],
};
const MEDIA_ACTIONS: JobAction[] = [...ACTIONS_BY_KIND.image, ...ACTIONS_BY_KIND.video, ...ACTIONS_BY_KIND.audio];

export type GalleryQuery = { kind?: MediaKind | null; page?: number; studentId?: string | null };
export type GalleryPage = { items: GalleryItem[]; page: number; hasMore: boolean };

function pageRange(page: number) {
  const from = page * GALLERY_PAGE_SIZE;
  return { from, to: from + GALLERY_PAGE_SIZE }; // на одну больше — чтобы знать, есть ли дальше
}

function actionsFor(kind: MediaKind | null | undefined): JobAction[] {
  return kind ? ACTIONS_BY_KIND[kind] : MEDIA_ACTIONS;
}

/** Свои генерации: картинки, видео, звук, монтаж. Все статусы — незавершённые опрашивает браузер. */
export async function listMyGallery(user: SessionUser, query: GalleryQuery = {}): Promise<GalleryPage> {
  const page = Math.max(0, query.page ?? 0);
  const { from, to } = pageRange(page);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", user.id)
    .in("action", actionsFor(query.kind))
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<JobRecord[]>();
  if (error) throw new Error(`gallery.listMyGallery failed (${error.code})`);
  const rows = data ?? [];
  const views = await toJobViews(rows.slice(0, GALLERY_PAGE_SIZE));
  return {
    items: views.map((view) => ({ ...view, author: null, mine: true })),
    page,
    hasMore: rows.length > GALLERY_PAGE_SIZE,
  };
}

/** Общая галерея группы для ученика — только если ведущий её включил. null — выключена. */
export async function listSharedGroupGallery(user: SessionUser, query: GalleryQuery = {}): Promise<GalleryPage | null> {
  const group = user.group;
  if (!group?.shareGallery || isStaff(user)) return null;
  const page = Math.max(0, query.page ?? 0);
  const { from, to } = pageRange(page);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("group_id", group.id)
    .neq("user_id", user.id)
    .eq("status", "done")
    .eq("hidden", false)
    .in("action", actionsFor(query.kind))
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<JobRecord[]>();
  if (error) throw new Error(`gallery.listSharedGroupGallery failed (${error.code})`);
  const rows = (data ?? []).slice(0, GALLERY_PAGE_SIZE);
  const [views, authors] = await Promise.all([
    toJobViews(rows, { promptLimit: 300 }),
    nicknamesInGroup(
      group.id,
      rows.map((row) => row.user_id),
    ),
  ]);
  return {
    items: views.map((view, i) => ({ ...view, author: authors.get(rows[i].user_id) ?? null, mine: false })),
    page,
    hasMore: (data ?? []).length > GALLERY_PAGE_SIZE,
  };
}

/** Галерея группы для ведущего: всё, кроме неудачных; скрытые видны с пометкой. Доступ проверяет вызывающий (getGroup). */
export async function listGroupGalleryForTeacher(
  user: SessionUser,
  groupId: string,
  query: GalleryQuery = {},
): Promise<GalleryPage> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const page = Math.max(0, query.page ?? 0);
  const { from, to } = pageRange(page);
  const supabase = await createClient();
  let request = supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("group_id", groupId)
    .in("action", actionsFor(query.kind))
    .neq("status", "failed");
  if (query.studentId && isUuid(query.studentId)) request = request.eq("user_id", query.studentId);
  const { data, error } = await request
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<JobRecord[]>();
  if (error) throw new Error(`gallery.listGroupGalleryForTeacher failed (${error.code})`);
  const rows = (data ?? []).slice(0, GALLERY_PAGE_SIZE);

  const ids = [...new Set(rows.map((row) => row.user_id))];
  const authors = new Map<string, string>();
  if (ids.length) {
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, login, nickname").in("id", ids);
    if (profilesError) throw new Error(`gallery.teacher authors failed (${profilesError.code})`);
    for (const p of profiles ?? []) authors.set(p.id, p.login ? `${p.nickname} · ${p.login}` : p.nickname);
  }

  const views = await toJobViews(rows, { revealHidden: true });
  return {
    items: views.map((view, i) => ({ ...view, author: authors.get(rows[i].user_id) ?? null, mine: rows[i].user_id === user.id })),
    page,
    hasMore: (data ?? []).length > GALLERY_PAGE_SIZE,
  };
}

async function nicknamesInGroup(groupId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  // Ники одногруппников клиенту по RLS не видны: читаем только ник и только внутри своей группы
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, nickname")
    .eq("group_id", groupId)
    .in("id", ids);
  if (error) throw new Error(`gallery.nicknames failed (${error.code})`);
  for (const p of data ?? []) result.set(p.id, p.nickname);
  return result;
}

// ---------- скрыть / показать (ведущий) ----------

export async function setJobHidden(
  user: SessionUser,
  jobId: string,
  hidden: boolean,
): Promise<{ ok: true; groupId: string } | { ok: false; error: "not_found" | "forbidden" }> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  if (!isUuid(jobId)) return { ok: false, error: "not_found" };
  const admin = createAdminClient();
  const { data: job, error } = await admin.from("jobs").select("id, user_id, group_id, action").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`gallery.setJobHidden load failed (${error.code})`);
  if (!job) return { ok: false, error: "not_found" };
  if (!job.group_id) return { ok: false, error: "forbidden" };
  const group = await assertTeachesGroup(user, job.group_id);

  const { error: updateError } = await admin
    .from("jobs")
    .update({ hidden, hidden_by: hidden ? user.id : null })
    .eq("id", job.id);
  if (updateError) throw new Error(`gallery.setJobHidden update failed (${updateError.code})`);

  await audit({
    actorId: user.id,
    action: hidden ? "job.hide" : "job.unhide",
    targetUser: job.user_id,
    targetGroup: group.id,
    meta: { jobId: job.id, action: job.action },
  });
  return { ok: true, groupId: group.id };
}

// ---------- файлы для референсов ----------

const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Berlin" });

/**
 * Готовые файлы, которые пользователь может подставить в генерацию: свои (последние 40)
 * и, если ведущий открыл общую галерею, файлы группы (последние 20).
 */
export async function listReferenceOptions(user: SessionUser): Promise<MediaOption[]> {
  const supabase = await createClient();
  const own = supabase
    .from("jobs")
    .select("id, user_id, action, prompt, storage_path, extra_paths, created_at")
    .eq("user_id", user.id)
    .eq("status", "done")
    .eq("hidden", false)
    .in("action", MEDIA_ACTIONS)
    .order("created_at", { ascending: false })
    .limit(40);
  const shared =
    user.group?.shareGallery && !isStaff(user)
      ? supabase
          .from("jobs")
          .select("id, user_id, action, prompt, storage_path, extra_paths, created_at")
          .eq("group_id", user.group.id)
          .neq("user_id", user.id)
          .eq("status", "done")
          .eq("hidden", false)
          .in("action", MEDIA_ACTIONS)
          .order("created_at", { ascending: false })
          .limit(20)
      : null;
  const [ownRes, sharedRes] = await Promise.all([own, shared]);
  if (ownRes.error) throw new Error(`gallery.listReferenceOptions failed (${ownRes.error.code})`);
  const rows = [...(ownRes.data ?? []), ...(sharedRes && !sharedRes.error ? (sharedRes.data ?? []) : [])];

  const authors =
    user.group && sharedRes?.data?.length
      ? await nicknamesInGroup(
          user.group.id,
          sharedRes.data.map((row) => row.user_id),
        )
      : new Map<string, string>();

  const files = rows.flatMap((row) =>
    row.storage_path ? [row.storage_path, ...row.extra_paths].map((path, index) => ({ row, path, index })) : [],
  );
  const signed = await signMediaPaths(files.map((f) => f.path));
  return files.flatMap(({ row, path, index }) => {
    const url = signed.get(path);
    const kind = mediaKindOfPath(path);
    if (!url || !kind) return [];
    const who = row.user_id === user.id ? "" : `${authors.get(row.user_id) ?? "группа"} · `;
    const extra = index > 0 ? ` · файл ${index + 1}` : "";
    return [{ path, url, kind, label: `${who}${jobActionLabels[row.action]} · ${shortDate.format(new Date(row.created_at))}${extra}` }];
  });
}

/** Драйверы движения из библиотеки курса (для motion). */
export async function listMotionLibrary(): Promise<MediaOption[]> {
  const files = (await listLibrary(MOTION_LIBRARY_FOLDER)).filter((file) => file.kind === "video");
  const signed = await signMediaPaths(files.map((file) => file.path));
  return files.flatMap((file) => {
    const url = signed.get(file.path);
    return url
      ? [{ path: file.path, url, kind: file.kind, label: file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "), library: true }]
      : [];
  });
}
