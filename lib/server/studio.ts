import "server-only";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { AuthError, type SessionUser } from "@/lib/server/dal/auth";
import { appUrl, ConfigError, supabasePublicConfig } from "@/lib/server/env";
import { completeJob, MEDIA_BUCKET, mediaPath } from "@/lib/server/jobs";
import { moderateFields } from "@/lib/server/moderation";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import type { JobAction, Json } from "@/lib/server/supabase/types";
import { createJobWithDebit, refundJob } from "@/lib/server/wallet";
import {
  MAX_MONTAGE_BYTES,
  type StudioCompleteResponse,
  type StudioMediaItem,
  type StudioMediaKind,
  type StudioMediaResponse,
  type StudioSaveResponse,
} from "@/lib/platform/montage/types";

/*
  Студия автомонтажа (урок 2, docs/platform/spec.md §6). Монтаж идёт в браузере ученика,
  сервер только:
    1) отдаёт список готовых медиа (свои + общая галерея группы, если учитель её включил)
       с подписанными ссылками на час;
    2) сохраняет готовый ролик: задача montage (0★) → подписанная ссылка на загрузку прямо
       в Storage → проверка файла → задача done и ролик в галерее.

  Права: каждый обработчик сам вызывает authorize(); список читается клиентом с сессией
  (RLS jobs_read пускает к своим задачам и к общей галерее группы), подписывает ссылки
  и пишет — admin-клиент, только после проверок. POST проверяют Origin.
*/

export const MONTAGE_MODEL = "platform/auto-montage";

const SIGNED_URL_TTL = 60 * 60;
const LIST_LIMIT = 150;
/** незавершённая загрузка старше этого — брошена, задачу закрываем */
const STALE_UPLOAD_MINUTES = 30;
/** сохранений в галерею за сутки на ученика */
const DAILY_SAVES = 40;

const KIND_BY_ACTION: Partial<Record<JobAction, StudioMediaKind>> = {
  video: "video",
  motion: "video",
  lipsync: "video",
  image: "image",
  image_edit: "image",
  voice: "voice",
  music: "music",
};
const MEDIA_ACTIONS = Object.keys(KIND_BY_ACTION) as JobAction[];

const EXT_BY_KIND: Record<StudioMediaKind, readonly string[]> = {
  video: ["mp4"],
  image: ["jpg", "jpeg", "png", "webp"],
  voice: ["mp3", "wav", "m4a"],
  music: ["mp3", "wav", "m4a"],
};

// ---------- HTTP ----------

/** POST только со своего сайта (защита от CSRF; браузер всегда шлёт Origin на POST). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(`${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`);
  try {
    const app = appUrl();
    if (app) allowed.add(new URL(app).origin);
  } catch {
    // APP_URL не задан или неверен — сверяемся только с адресом запроса
  }
  return allowed.has(origin);
}

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Тело JSON не больше limit байт. null — пустое, слишком большое или не JSON. */
export async function readJson(request: Request, limit = 64 * 1024): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const text = await request.text();
  if (!text || text.length > limit) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Ошибка → ответ с кодом; подробности только в лог. */
export function studioFailure(error: unknown, op: string): Response {
  if (error instanceof AuthError) return json({ ok: false, error: error.code }, error.code === "unauthorized" ? 401 : 403);
  if (error instanceof ConfigError) return json({ ok: false, error: "not_configured" }, 503);
  console.error(`studio.${op}: unexpected error`, { message: error instanceof Error ? error.message : String(error) });
  return json({ ok: false, error: "server_error" }, 500);
}

// ---------- список медиа ----------

type JobListRow = {
  id: string;
  user_id: string;
  action: JobAction;
  params: Json;
  prompt: string | null;
  storage_path: string | null;
  extra_paths: string[];
  mime_type: string | null;
  created_at: string;
};

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * Текст реплики для субтитра: поле text задачи озвучки, иначе промпт.
 * Если промпт заполнен по шаблону урока («Голос: … Стиль: … Текст: «…»»), берём только текст.
 */
export function lineText(params: Json, prompt: string | null): string | null {
  const p = record(params);
  const raw = typeof p.text === "string" && p.text.trim() ? p.text : (prompt ?? "");
  const fromTemplate = /Текст:\s*[«"„]([^»"“]+)[»"“]/u.exec(raw);
  const text = oneLine(fromTemplate ? fromTemplate[1] : raw, 300);
  return text || null;
}

function positiveNumber(value: Json | undefined): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 && n < 3600 ? n : null;
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

type Candidate = Omit<StudioMediaItem, "url"> & { path: string; userId: string };

function candidates(row: JobListRow, own: boolean): Candidate[] {
  const kind = KIND_BY_ACTION[row.action];
  if (!kind || !row.storage_path) return [];
  const p = record(row.params);
  const prompt = row.prompt ?? "";
  const paths = kind === "music" ? [row.storage_path, ...row.extra_paths] : [row.storage_path];
  return paths
    .filter((path) => path.startsWith(`${row.user_id}/`) && EXT_BY_KIND[kind].includes(extOf(path)))
    .map((path, index) => {
      const musicTitle = typeof p.title === "string" && p.title.trim() ? p.title : prompt;
      const title =
        kind === "music"
          ? oneLine(`${musicTitle || "Музыка"}${paths.length > 1 ? ` · трек ${index + 1}` : ""}`, 70)
          : kind === "voice"
            ? oneLine(lineText(row.params, row.prompt) ?? "Реплика", 70)
            : oneLine(prompt || (kind === "image" ? "Картинка" : "Клип"), 70);
      return {
        id: index === 0 ? row.id : `${row.id}:${index + 1}`,
        jobId: row.id,
        kind,
        ext: extOf(path) === "jpeg" ? "jpg" : extOf(path),
        mimeType: index === 0 ? row.mime_type : null,
        title,
        text: kind === "voice" ? lineText(row.params, row.prompt) : null,
        voice: kind === "voice" && typeof p.voice === "string" ? oneLine(p.voice, 40) : null,
        duration: kind === "video" || kind === "music" ? positiveNumber(p.duration) : null,
        createdAt: row.created_at,
        own,
        author: null,
        path,
        userId: row.user_id,
      };
    });
}

/** Готовые клипы, картинки, озвучки и музыка для студии: свои и (если можно) группы. */
export async function listStudioMedia(user: SessionUser): Promise<StudioMediaResponse> {
  const supabase = await createClient();
  const columns = "id, user_id, action, params, prompt, storage_path, extra_paths, mime_type, created_at";
  const ready = () =>
    supabase
      .from("jobs")
      .select(columns)
      .eq("status", "done")
      .eq("hidden", false)
      .in("action", MEDIA_ACTIONS)
      .not("storage_path", "is", null);

  const shareGallery = Boolean(user.group?.shareGallery);
  const [own, shared] = await Promise.all([
    ready()
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT)
      .returns<JobListRow[]>(),
    // общая галерея: RLS (jobs_read) и так пускает только при share_gallery, фильтр — для ясности
    shareGallery && user.group
      ? ready()
          .eq("group_id", user.group.id)
          .neq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT)
          .returns<JobListRow[]>()
      : Promise.resolve({ data: [] as JobListRow[], error: null }),
  ]);
  if (own.error) throw new Error(`studio.list own failed (${own.error.code})`);
  if (shared.error) throw new Error(`studio.list group failed (${shared.error.code})`);

  const list = [
    ...(own.data ?? []).flatMap((row) => candidates(row, true)),
    ...(shared.data ?? []).flatMap((row) => candidates(row, false)),
  ];
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString();
  if (list.length === 0) return { items: [], me: { nickname: user.nickname }, shareGallery, expiresAt };

  const admin = createAdminClient();
  const otherIds = [...new Set(list.filter((c) => !c.own).map((c) => c.userId))];
  const [signed, profiles] = await Promise.all([
    admin.storage.from(MEDIA_BUCKET).createSignedUrls(
      list.map((c) => c.path),
      SIGNED_URL_TTL,
    ),
    otherIds.length
      ? admin.from("profiles").select("id, nickname").in("id", otherIds)
      : Promise.resolve({ data: [] as { id: string; nickname: string }[], error: null }),
  ]);
  if (signed.error) throw new Error(`studio.list sign failed (${signed.error.message})`);
  const urlByPath = new Map<string, string>();
  for (const entry of signed.data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) urlByPath.set(entry.path, entry.signedUrl);
  }
  const nickById = new Map((profiles.data ?? []).map((p) => [p.id, p.nickname]));

  const items: StudioMediaItem[] = [];
  for (const { path, userId, ...item } of list) {
    const url = urlByPath.get(path);
    if (!url) continue;
    items.push({ ...item, url, author: item.own ? null : (nickById.get(userId) ?? null) });
  }
  return { items, me: { nickname: user.nickname }, shareGallery, expiresAt };
}

// ---------- сохранение ----------

const uuid = z.uuid();
const optionalRef = (re: RegExp, max: number) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(max).regex(re).nullable());

export const saveRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  dryRun: z.boolean().optional(),
  title: z.string().max(200).default(""),
  authors: z.string().max(200).default(""),
  subtitles: z.array(z.string().max(400)).max(12).default([]),
  scenes: z
    .array(z.object({ jobId: uuid, lineJobId: uuid.nullable() }))
    .min(1)
    .max(12)
    .optional(),
  musicJobId: uuid.nullable().optional(),
  durationSec: z.number().min(0.5).max(62).optional(),
  sizeBytes: z.number().int().min(1).max(MAX_MONTAGE_BYTES).optional(),
  lessonId: optionalRef(/^[a-z0-9-]{1,40}$/, 40).optional(),
  taskRef: optionalRef(/^[A-Za-z0-9_.-]{1,80}$/, 80).optional(),
});

export type SaveRequest = z.infer<typeof saveRequestSchema>;

/** Отказ модерации — запись в журнал и код для интерфейса. */
async function moderate(user: SessionUser, input: SaveRequest): Promise<StudioSaveResponse | null> {
  const result = moderateFields(
    { title: input.title, authors: input.authors, subtitles: input.subtitles.join("\n") },
    { maxLength: 6000 },
  );
  if (result.ok) return null;
  await audit({
    actorId: user.id,
    action: "moderation.blocked",
    targetUser: user.id,
    targetGroup: user.group?.id ?? null,
    meta: { where: "studio", reason: result.reason, field: result.field ?? null },
  }).catch(() => undefined);
  return { ok: false, error: result.reason, field: result.field };
}

/** Брошенные загрузки (вкладку закрыли) не должны висеть «в работе» и мешать генерациям. */
async function closeStaleUploads(userId: string): Promise<void> {
  const admin = createAdminClient();
  const before = new Date(Date.now() - STALE_UPLOAD_MINUTES * 60 * 1000).toISOString();
  const { data } = await admin
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("action", "montage")
    .eq("status", "queued")
    .lt("created_at", before)
    .limit(10);
  for (const row of data ?? []) await refundJob(row.id, "upload_abandoned");
}

async function savesToday(userId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "montage")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (error) throw new Error(`studio.savesToday failed (${error.code})`);
  return count ?? 0;
}

/**
 * Проверить тексты и (если не dryRun) создать задачу монтажа с подписанной ссылкой на загрузку.
 * Повтор с тем же idempotencyKey вернёт ту же задачу (двойной клик, повторная загрузка).
 */
export async function createMontageUpload(user: SessionUser, input: SaveRequest): Promise<{ status: number; body: StudioSaveResponse }> {
  const blocked = await moderate(user, input);
  if (blocked) return { status: 400, body: blocked };
  if (input.dryRun) return { status: 200, body: { ok: true, dryRun: true } };
  if (!input.scenes || !input.durationSec || !input.sizeBytes) {
    return { status: 400, body: { ok: false, error: "invalid_input" } };
  }

  await closeStaleUploads(user.id);
  if ((await savesToday(user.id)) >= DAILY_SAVES) return { status: 429, body: { ok: false, error: "rate_limited" } };

  const params: Record<string, Json | undefined> = {
    kind: "montage",
    scenes: input.scenes.map((s) => ({ jobId: s.jobId, lineJobId: s.lineJobId })),
    musicJobId: input.musicJobId ?? null,
    durationSec: Math.round(input.durationSec * 100) / 100,
    sizeBytes: input.sizeBytes,
    authors: input.authors.slice(0, 120) || null,
  };
  const created = await createJobWithDebit({
    userId: user.id,
    action: "montage",
    model: MONTAGE_MODEL,
    stars: 0,
    idempotencyKey: input.idempotencyKey,
    params,
    prompt: input.title.trim().slice(0, 200) || null,
    lessonId: input.lessonId ?? null,
    taskRef: input.taskRef ?? null,
  });
  if (!created.ok) {
    const status = created.error === "server_error" ? 500 : created.error === "user_disabled" ? 403 : 400;
    return { status, body: { ok: false, error: created.error } };
  }

  const admin = createAdminClient();
  const { data: job, error } = await admin.from("jobs").select("status").eq("id", created.jobId).maybeSingle();
  if (error || !job) throw new Error(`studio.save job lookup failed (${error?.code ?? "missing"})`);
  const base = { ok: true as const, jobId: created.jobId, maxBytes: MAX_MONTAGE_BYTES };
  if (job.status === "done") return { status: 200, body: { ...base, done: true, uploadUrl: null, apiKey: null } };
  if (job.status !== "queued") return { status: 409, body: { ok: false, error: "job_failed" } };

  const path = mediaPath(user.id, created.jobId, "mp4");
  const upload = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (upload.error || !upload.data) throw new Error(`studio.save signed upload failed (${upload.error?.message ?? "empty"})`);
  return {
    status: 200,
    body: { ...base, done: false, uploadUrl: upload.data.signedUrl, apiKey: supabasePublicConfig().publishableKey },
  };
}

/** Первые байты файла: mp4 начинается с бокса ftyp. */
async function looksLikeMp4(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return false;
  const response = await fetch(data.signedUrl, { headers: { Range: "bytes=0-11" }, cache: "no-store" });
  if (!response.ok) return false;
  const head = new Uint8Array(await response.arrayBuffer()).slice(0, 12);
  return head.length >= 8 && String.fromCharCode(...head.slice(4, 8)) === "ftyp";
}

/**
 * Загрузка закончена (или отменена — abort). Проверяем, что файл есть, это mp4 и он не больше
 * лимита, и закрываем задачу. Только своя задача montage.
 */
export async function finishMontageUpload(
  user: SessionUser,
  jobId: string,
  abort: boolean,
): Promise<{ status: number; body: StudioCompleteResponse }> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("jobs")
    .select("id, user_id, action, status")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`studio.complete lookup failed (${error.code})`);
  if (!job || job.user_id !== user.id || job.action !== "montage") return { status: 404, body: { ok: false, error: "not_found" } };
  if (job.status === "done") return { status: 200, body: { ok: true, status: "done" } };
  if (job.status === "failed") return { status: 409, body: { ok: false, error: "job_failed" } };

  const path = mediaPath(user.id, jobId, "mp4");
  const bucket = admin.storage.from(MEDIA_BUCKET);
  const fail = async (reason: string) => {
    await bucket.remove([path]).catch(() => undefined);
    const refunded = await refundJob(jobId, reason);
    if (!refunded.ok) throw new Error(`studio.complete close failed (${refunded.error})`);
  };

  if (abort) {
    await fail("upload_cancelled");
    return { status: 200, body: { ok: true, status: "failed" } };
  }

  const { data: listed, error: listError } = await bucket.list(user.id, { search: `${jobId}.mp4`, limit: 5 });
  if (listError) throw new Error(`studio.complete list failed (${listError.message})`);
  const object = (listed ?? []).find((o) => o.name === `${jobId}.mp4`);
  if (!object) return { status: 409, body: { ok: false, error: "upload_missing" } };

  const meta = (object.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
  const size = typeof meta.size === "number" ? meta.size : Number(meta.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_MONTAGE_BYTES) {
    await fail("too_large");
    return { status: 413, body: { ok: false, error: "too_large" } };
  }
  if ((typeof meta.mimetype === "string" && meta.mimetype !== "video/mp4") || !(await looksLikeMp4(path))) {
    await fail("bad_file");
    return { status: 400, body: { ok: false, error: "bad_file" } };
  }

  const done = await completeJob(jobId, { storagePath: path, mimeType: "video/mp4" });
  if (!done) return { status: 409, body: { ok: false, error: "job_failed" } };
  return { status: 200, body: { ok: true, status: "done" } };
}
