import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { getLessonById } from "@/lib/server/course";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { assertTeachesGroup, isUuid } from "@/lib/server/dal/teacher";
import { ConfigError, supabasePublicConfig } from "@/lib/server/env";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import { setLessonStep } from "@/lib/server/lesson-progress";
import { moderateFields } from "@/lib/server/moderation";
import { signMediaPaths } from "@/lib/server/storage";
import { json } from "@/lib/server/studio";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import {
  AI_EMPTY_FILE_NOTE,
  AI_FAILED_NOTE,
  AI_SKIPS_LARGE_NOTE,
  AI_SKIPS_MEDIA_NOTE,
  MAX_HOMEWORK_BYTES,
  MAX_HOMEWORK_LINK,
  MAX_HOMEWORK_NOTE,
  MAX_HOMEWORK_TEXT,
  type HomeworkAiFeedback,
  type HomeworkExt,
  type HomeworkView,
} from "@/lib/platform/homework-types";
import { LESSON_STEP_HOMEWORK } from "@/lib/platform/lesson-types";
import { cleanFileName, extOfPath, headMatchesExt, homeworkExt, homeworkMime } from "./files";
import { gradeSubmission, STALE_GRADING_SEC, type HomeworkRow } from "./grade";

/*
  Сдача домашки (docs/platform/spec.md «Домашки»). Поток как у монтажа:
    1) POST /api/homework — строка (uploading для файла, submitted для текста и ссылки)
       и подписанная ссылка на загрузку файла прямо в Storage;
    2) браузер кладёт файл (PUT);
    3) POST /api/homework/[id]/complete — файл на месте, размер и первые байты сходятся →
       submitted, шаг «домашка» отмечен, проверка моделью с бюджетом GRADE_BUDGET_MS;
       не успела — ответ со статусом grading, браузер опрашивает GET /api/homework/[id],
       который доводит проверку до конца.
  Права: каждый вход проверяет пользователя сам; ученик видит и сдаёт только своё,
  ведущий читает и оценивает сдачи своих групп. Пишет только admin-клиент.
*/

const DAILY_SUBMISSIONS = 20;
const GRADE_BUDGET_MS = 45_000;

export type HomeworkErrorBody = { ok: false; error: string; field?: string };
export type HomeworkUpload = { url: string; contentType: string; apiKey: string | null; maxBytes: number };
export type HomeworkSaveBody = { ok: true; homework: HomeworkView; upload: HomeworkUpload | null } | HomeworkErrorBody;
export type HomeworkStateBody = { ok: true; homework: HomeworkView | null } | HomeworkErrorBody;

type Reply<T> = { status: number; body: T };

export function homeworkPath(userId: string, id: string, ext: string): string {
  return `${userId}/homework/${id}.${ext}`;
}

/** Ошибка → ответ с кодом; подробности только в лог. */
export function homeworkFailure(error: unknown, op: string): Response {
  if (error instanceof AuthError) return json({ ok: false, error: error.code }, error.code === "unauthorized" ? 401 : 403);
  if (error instanceof ConfigError) return json({ ok: false, error: "not_configured" }, 503);
  console.error(`homework.${op}: unexpected error`, { message: error instanceof Error ? error.message : String(error) });
  return json({ ok: false, error: "server_error" }, 500);
}

// ---------- представление ----------

function feedbackOf(value: unknown): HomeworkAiFeedback | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.criteria) || typeof v.summary !== "string") return null;
  return {
    criteria: v.criteria
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) => ({
        name: String(c.name ?? ""),
        verdict: c.verdict === "да" || c.verdict === "частично" ? c.verdict : "нет",
        note: String(c.note ?? ""),
      })),
    summary: v.summary,
    tips: Array.isArray(v.tips) ? v.tips.filter((t): t is string => typeof t === "string") : [],
  };
}

function aiNote(row: HomeworkRow): string | null {
  if (row.status === "failed") return row.ai_error === "empty" ? AI_EMPTY_FILE_NOTE : AI_FAILED_NOTE;
  if (row.status === "submitted" && row.ai_error === "media") return AI_SKIPS_MEDIA_NOTE;
  if (row.status === "submitted" && row.ai_error === "too_large") return AI_SKIPS_LARGE_NOTE;
  return null;
}

export async function toHomeworkView(row: HomeworkRow): Promise<HomeworkView> {
  const path = row.status !== "uploading" ? row.storage_path : null;
  const signed = path ? await signMediaPaths([path]) : null;
  const feedback = row.status === "graded" && row.ai_score !== null ? feedbackOf(row.ai_feedback) : null;
  return {
    id: row.id,
    lessonId: row.lesson_id,
    kind: row.kind,
    status: row.status,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    fileUrl: path ? (signed?.get(path) ?? null) : null,
    linkUrl: row.link_url,
    text: row.kind === "text" ? row.text_body : null,
    note: row.kind === "text" ? null : row.text_body,
    ai: feedback && row.ai_score !== null ? { score: row.ai_score, feedback, model: row.ai_model } : null,
    aiNote: aiNote(row),
    teacher:
      row.teacher_score !== null
        ? { score: row.teacher_score, comment: row.teacher_comment, gradedAt: row.teacher_graded_at ?? row.updated_at }
        : null,
    createdAt: row.created_at,
  };
}

// ---------- чтение ----------

/** Действующая сдача ученика по уроку (через RLS). Незаконченная загрузка — как будто сдачи нет. */
export async function getLessonHomework(user: SessionUser, lessonId: string): Promise<HomeworkView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("homework_submissions")
    .select("*")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .is("superseded_at", null)
    .maybeSingle<HomeworkRow>();
  if (error) throw new Error(`homework.getLessonHomework failed (${error.code})`);
  if (!data || data.status === "uploading") return null;
  return toHomeworkView(data);
}

async function loadRow(id: string): Promise<HomeworkRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await createAdminClient().from("homework_submissions").select("*").eq("id", id).maybeSingle<HomeworkRow>();
  if (error) throw new Error(`homework.loadRow failed (${error.code})`);
  return data;
}

/** Строка, если она своя или из группы, которую ведёт пользователь. */
async function loadForViewer(user: SessionUser, id: string): Promise<HomeworkRow | null> {
  const row = await loadRow(id);
  if (!row) return null;
  if (row.user_id === user.id) return row;
  if (!isStaff(user)) return null;
  if (!row.group_id) return user.role === "admin" ? row : null;
  try {
    await assertTeachesGroup(user, row.group_id);
  } catch {
    return null;
  }
  return row;
}

// ---------- проверка с бюджетом ----------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Проверить работу, но ответить не позже GRADE_BUDGET_MS. Проверка продолжается после ответа
 * (after() держит функцию живой до maxDuration); если и этого не хватило — строка остаётся
 * grading и её доведёт следующий опрос.
 */
async function gradeWithinBudget(id: string): Promise<void> {
  const run = gradeSubmission(id).catch((error: unknown) => {
    console.error("homework.grade: failed", { message: error instanceof Error ? error.message : String(error) });
  });
  after(() => run);
  await Promise.race([run, sleep(GRADE_BUDGET_MS)]);
}

function gradingIsStale(row: HomeworkRow): boolean {
  if (row.status !== "grading") return false;
  const started = row.grading_started_at ? Date.parse(row.grading_started_at) : 0;
  return Date.now() - started > STALE_GRADING_SEC * 1000;
}

/** Состояние сдачи для опроса. Незаконченную или зависшую проверку доводит до конца. */
export async function pollSubmission(user: SessionUser, id: string): Promise<Reply<HomeworkStateBody>> {
  const row = await loadForViewer(user, id);
  if (!row) return { status: 404, body: { ok: false, error: "homework_not_found" } };
  // submitted без ai_error — проверка не начиналась (или не успела отметить «ИИ не читает»); grading без движения — зависла
  const pending = (row.status === "submitted" && !row.ai_error) || gradingIsStale(row);
  if (pending && !row.superseded_at) {
    await gradeWithinBudget(row.id);
    const fresh = await loadRow(row.id);
    return { status: 200, body: { ok: true, homework: fresh ? await toHomeworkView(fresh) : null } };
  }
  return { status: 200, body: { ok: true, homework: await toHomeworkView(row) } };
}

// ---------- сдача ----------

const trimmed = (max: number) => z.string().max(max).transform((value) => value.trim());

export const createSubmissionSchema = z.object({
  lessonId: z.string().regex(/^lesson-[0-9]{1,2}$/),
  kind: z.enum(["file", "text", "link"]),
  fileName: z.string().max(400).optional(),
  sizeBytes: z.number().int().min(1).max(MAX_HOMEWORK_BYTES).optional(),
  text: trimmed(MAX_HOMEWORK_TEXT).optional(),
  linkUrl: trimmed(MAX_HOMEWORK_LINK).optional(),
  note: trimmed(MAX_HOMEWORK_NOTE).optional(),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

function httpsLink(value: string | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
}

async function submissionsToday(userId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("homework_submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    // сорвавшиеся загрузки (строка так и осталась в uploading) лимит не тратят:
    // иначе 20 неудачных попыток за день блокируют ученика сообщением «слишком много попыток»
    .neq("status", "uploading")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (error) throw new Error(`homework.submissionsToday failed (${error.code})`);
  return count ?? 0;
}

/** Прошлая действующая сдача по уроку уходит в историю: одна действующая на ученика и урок. */
async function supersedeActive(userId: string, lessonId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("homework_submissions")
    .update({ superseded_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("lesson_id", lessonId)
    .is("superseded_at", null);
  if (error) throw new Error(`homework.supersede failed (${error.code})`);
}

/**
 * Создать сдачу. Файл: строка uploading + подписанная ссылка на загрузку.
 * Текст и ссылка: строка submitted, шаг «домашка» отмечен, проверка моделью сразу.
 */
export async function createSubmission(user: SessionUser, input: CreateSubmissionInput): Promise<Reply<HomeworkSaveBody>> {
  const lesson = getLessonById(input.lessonId);
  if (!lesson) return { status: 400, body: { ok: false, error: "lesson_not_found" } };
  if (!isStaff(user) && !user.group) return { status: 403, body: { ok: false, error: "no_group" } };

  let fileName: string | null = null;
  let mime: string | null = null;
  let ext: HomeworkExt | null = null;
  let link: string | null = null;
  let text: string | null = null;
  const note = input.note || null;
  if (input.kind === "file") {
    fileName = cleanFileName(input.fileName ?? "");
    ext = homeworkExt(fileName);
    if (!fileName || !ext) return { status: 400, body: { ok: false, error: "bad_file_type" } };
    if (!input.sizeBytes) return { status: 400, body: { ok: false, error: "invalid_input" } };
    mime = homeworkMime(ext);
  } else if (input.kind === "link") {
    link = httpsLink(input.linkUrl);
    if (!link) return { status: 400, body: { ok: false, error: "bad_link" } };
  } else {
    text = input.text || null;
    if (!text) return { status: 400, body: { ok: false, error: "empty_text" } };
  }

  const moderation = moderateFields({ text, note, fileName }, { maxLength: MAX_HOMEWORK_TEXT });
  if (!moderation.ok) {
    await audit({
      actorId: user.id,
      action: "moderation.blocked",
      targetUser: user.id,
      targetGroup: user.group?.id ?? null,
      meta: { where: "homework", reason: moderation.reason, field: moderation.field ?? null, lesson: input.lessonId },
    });
    return { status: 400, body: { ok: false, error: moderation.reason, field: moderation.field } };
  }
  if ((await submissionsToday(user.id)) >= DAILY_SUBMISSIONS) return { status: 429, body: { ok: false, error: "rate_limited" } };

  await supersedeActive(user.id, input.lessonId);
  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const path = ext ? homeworkPath(user.id, id, ext) : null;
  const { data: row, error } = await admin
    .from("homework_submissions")
    .insert({
      id,
      user_id: user.id,
      group_id: user.group?.id ?? null,
      lesson_id: input.lessonId,
      kind: input.kind,
      text_body: input.kind === "text" ? text : note,
      link_url: link,
      storage_path: path,
      file_name: fileName,
      mime,
      size_bytes: input.sizeBytes ?? null,
      status: input.kind === "file" ? "uploading" : "submitted",
    })
    .select("*")
    .single<HomeworkRow>();
  if (error) {
    if (error.code === "23505") return { status: 409, body: { ok: false, error: "already_submitting" } };
    throw new Error(`homework.create insert failed (${error.code})`);
  }

  if (input.kind === "file" && path) {
    const upload = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (upload.error || !upload.data) throw new Error(`homework.create signed upload failed (${upload.error?.message ?? "empty"})`);
    return {
      status: 200,
      body: {
        ok: true,
        homework: await toHomeworkView(row),
        upload: { url: upload.data.signedUrl, contentType: mime!, apiKey: supabasePublicConfig().publishableKey, maxBytes: MAX_HOMEWORK_BYTES },
      },
    };
  }

  await setLessonStep(user.id, input.lessonId, LESSON_STEP_HOMEWORK, true);
  await gradeWithinBudget(row.id);
  const fresh = (await loadRow(row.id)) ?? row;
  return { status: 200, body: { ok: true, homework: await toHomeworkView(fresh), upload: null } };
}

/** Первые байты файла в Storage (для сверки с расширением). */
async function readHead(path: string): Promise<Uint8Array | null> {
  const signed = await signMediaPaths([path], 60);
  const url = signed.get(path);
  if (!url) return null;
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-15" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer()).slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Загрузка файла закончена (или отменена — abort): файл на месте, размер и первые байты сходятся →
 * submitted, шаг «домашка» отмечен, проверка моделью. Только своя строка в статусе uploading.
 */
export async function completeSubmission(user: SessionUser, id: string, abort: boolean): Promise<Reply<HomeworkStateBody>> {
  const row = await loadRow(id);
  if (!row || row.user_id !== user.id || row.kind !== "file" || !row.storage_path) {
    return { status: 404, body: { ok: false, error: "homework_not_found" } };
  }
  if (row.status !== "uploading") return { status: 200, body: { ok: true, homework: await toHomeworkView(row) } };

  const admin = createAdminClient();
  const bucket = admin.storage.from(MEDIA_BUCKET);
  const path = row.storage_path;
  const ext = extOfPath(path);
  const dropFile = () => bucket.remove([path]).catch(() => undefined);

  if (abort || !ext) {
    await dropFile();
    await admin.from("homework_submissions").update({ superseded_at: new Date().toISOString() }).eq("id", row.id).eq("status", "uploading");
    return { status: 200, body: { ok: true, homework: null } };
  }

  const fileName = `${row.id}.${ext}`;
  const { data: listed, error: listError } = await bucket.list(`${user.id}/homework`, { search: fileName, limit: 5 });
  if (listError) throw new Error(`homework.complete list failed (${listError.message})`);
  const object = (listed ?? []).find((o) => o.name === fileName);
  if (!object) return { status: 409, body: { ok: false, error: "upload_missing" } };

  const meta = (object.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
  const size = typeof meta.size === "number" ? meta.size : Number(meta.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_HOMEWORK_BYTES) {
    await dropFile();
    return { status: 413, body: { ok: false, error: "file_too_large" } };
  }
  const head = await readHead(path);
  if (!head || !headMatchesExt(head, ext)) {
    await dropFile();
    return { status: 400, body: { ok: false, error: "bad_file" } };
  }

  const { data: updated, error } = await admin
    .from("homework_submissions")
    .update({ status: "submitted", size_bytes: size })
    .eq("id", row.id)
    .eq("status", "uploading")
    .select("*")
    .maybeSingle<HomeworkRow>();
  if (error) throw new Error(`homework.complete update failed (${error.code})`);
  if (!updated) return { status: 409, body: { ok: false, error: "already_submitting" } };

  await setLessonStep(user.id, row.lesson_id, LESSON_STEP_HOMEWORK, true);
  await gradeWithinBudget(row.id);
  const fresh = (await loadRow(row.id)) ?? updated;
  return { status: 200, body: { ok: true, homework: await toHomeworkView(fresh) } };
}

// ---------- ведущий ----------

export type HomeworkCell = {
  id: string;
  userId: string;
  lessonId: string;
  kind: HomeworkRow["kind"];
  status: HomeworkRow["status"];
  aiScore: number | null;
  aiSkipped: boolean;
  teacherScore: number | null;
  createdAt: string;
};

/** Действующие сдачи группы одним запросом (через RLS ведущего). Вызывать после getGroup. */
export async function listGroupHomework(user: SessionUser, groupId: string): Promise<HomeworkCell[]> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("homework_submissions")
    .select("id, user_id, lesson_id, kind, status, ai_score, ai_error, teacher_score, created_at")
    .eq("group_id", groupId)
    .is("superseded_at", null)
    .neq("status", "uploading")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`homework.listGroupHomework failed (${error.code})`);
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    lessonId: row.lesson_id,
    kind: row.kind,
    status: row.status,
    aiScore: row.ai_score,
    aiSkipped: row.status === "submitted" && row.ai_error !== null,
    teacherScore: row.teacher_score,
    createdAt: row.created_at,
  }));
}

export type TeacherHomework = {
  homework: HomeworkView;
  student: { id: string; nickname: string; login: string | null };
  groupId: string | null;
  superseded: boolean;
};

/** Сдача для ведущего группы (или админа), с подписанной ссылкой на файл. null — нет или чужая. */
export async function getHomeworkForTeacher(user: SessionUser, id: string): Promise<TeacherHomework | null> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const row = await loadForViewer(user, id);
  if (!row || row.status === "uploading") return null;
  const { data: profile, error } = await createAdminClient().from("profiles").select("id, nickname, login").eq("id", row.user_id).maybeSingle();
  if (error) throw new Error(`homework.getHomeworkForTeacher profile failed (${error.code})`);
  return {
    homework: await toHomeworkView(row),
    student: { id: row.user_id, nickname: profile?.nickname ?? "—", login: profile?.login ?? null },
    groupId: row.group_id,
    superseded: row.superseded_at !== null,
  };
}

/** Оценка ведущего (1–10) и комментарий. Только ведущий этой группы или админ; пишет audit_log. */
export async function setTeacherGrade(
  user: SessionUser,
  id: string,
  grade: { score: number; comment: string },
): Promise<{ ok: true } | { ok: false; error: "homework_not_found" | "forbidden" }> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const row = await loadForViewer(user, id);
  if (!row || row.user_id === user.id) return { ok: false, error: "homework_not_found" };
  const { error } = await createAdminClient()
    .from("homework_submissions")
    .update({
      teacher_score: grade.score,
      teacher_comment: grade.comment || null,
      teacher_id: user.id,
      teacher_graded_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(`homework.setTeacherGrade failed (${error.code})`);
  await audit({
    actorId: user.id,
    action: "homework.teacher_grade",
    targetUser: row.user_id,
    targetGroup: row.group_id,
    meta: { submission: row.id, lesson: row.lesson_id, score: grade.score, aiScore: row.ai_score },
  });
  return { ok: true };
}
