import "server-only";
import { audit } from "@/lib/server/audit";
import { getLessonById } from "@/lib/server/course";
import { generateText } from "@/lib/server/gateway";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Database, Json } from "@/lib/server/supabase/types";
import { attachmentIds } from "./attachment-rules";
import { attachmentsForGrading, loadAttachments } from "./attachments";
import { extractHomeworkText } from "./extract";
import { extOfPath, fileClass } from "./files";
import {
  buildNotesPrompt,
  gradingMaterial,
  honestSummary,
  MAX_NOTE_FAILURES,
  NOTES_MAX_TOKENS,
  NOTES_SYSTEM_PROMPT,
  parseNotes,
  planPasses,
  resumeState,
  type GradingState,
} from "./passes";
import {
  buildGradePrompt,
  buildGradePromptFromNotes,
  fitsOnePrompt,
  GRADE_MAX_TOKENS,
  GRADE_SYSTEM_PROMPT,
  parseGradeJson,
  RETRY_SUFFIX,
  type ParsedGrade,
  type RubricLesson,
  type WorkForGrading,
} from "./rubric";

/*
  Автоматическая проверка домашки (docs/platform/spec.md «Домашки»).
    submitted ──claim──▶ grading ──▶ graded (оценка 1–10, критерии, выжимка, советы)
                                 └──▶ failed (модель не ответила или вернула не JSON дважды)
  Картинки, видео, звук и файлы больше MAX_EXTRACT_BYTES модель не читает: строка остаётся
  submitted с ai_error = media | too_large, оценивает ведущий. Исключение — к медиафайлу
  прикреплены результаты из галереи: тогда ИИ проверяет комментарий и набор результатов.
  Модель — цепочка generateText (Kimi → Haiku), звёзды ученика не тратятся: платит владелец.
  Захват строки (claim) — одним update со статусом и временем: два одновременных запроса
  (complete и опрос) не проверят работу дважды; зависшую проверку (> STALE_GRADING_SEC)
  следующий опрос перехватывает и проверяет заново.

  Короткая работа — один вызов модели (как раньше). Длинная (не помещается в один промпт
  целиком) — по частям (passes.ts): на каждую часть вызов «заметки», потом оценка по заметкам.
  Один вызов — до ~40 с, у запроса ~45–60 с, поэтому после каждой части прогресс пишется
  в grading_progress (вместе с новым grading_started_at — «я ещё работаю»). Новую часть вызов
  начинает, только если с его начала прошло меньше STEP_START_LIMIT_MS; иначе отпускает строку
  (grading_started_at = null), и следующий опрос браузера продолжает со следующей части.
  Каждая запись прогресса проверяет, что захват всё ещё наш (grading_started_at не сменился).
*/

export type HomeworkRow = Database["public"]["Tables"]["homework_submissions"]["Row"];

/** Больше этого файл из Storage не скачиваем и не читаем (память функции). */
export const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
export const STALE_GRADING_SEC = 90;
/** Начинать следующий вызов модели в том же запросе, только если с начала прошло меньше этого. */
export const STEP_START_LIMIT_MS = 12_000;

/** Почему ИИ не оценил (ai_error): пропуск при статусе submitted или причина failed. */
export type AiSkipCode = "media" | "too_large";
export type AiFailCode = "unreadable" | "empty" | "gateway" | "bad_json" | "lesson_missing" | "download_failed" | "server_error";

/** Модель может прочитать работу (текст, ссылка, документ подходящего размера, медиафайл с результатами из галереи). */
export function aiCanRead(
  row: Pick<HomeworkRow, "kind" | "storage_path" | "size_bytes"> & { attachments?: Json | null },
): { ok: true } | { ok: false; skip: AiSkipCode } {
  if (row.kind !== "file") return { ok: true };
  const ext = extOfPath(row.storage_path);
  if (!ext || fileClass(ext) !== "document") {
    return attachmentIds(row.attachments).length > 0 ? { ok: true } : { ok: false, skip: "media" };
  }
  if ((row.size_bytes ?? 0) > MAX_EXTRACT_BYTES) return { ok: false, skip: "too_large" };
  return { ok: true };
}

async function markSkipped(id: string, skip: AiSkipCode): Promise<void> {
  const { error } = await createAdminClient()
    .from("homework_submissions")
    .update({ ai_error: skip })
    .eq("id", id)
    .eq("status", "submitted")
    .is("ai_error", null);
  if (error) console.error("homework.grade: skip mark failed", { code: error.code });
}

async function markFailed(id: string, reason: AiFailCode): Promise<void> {
  const { error } = await createAdminClient()
    .from("homework_submissions")
    .update({ status: "failed", ai_error: reason })
    .eq("id", id)
    .eq("status", "grading");
  if (error) console.error("homework.grade: fail mark failed", { code: error.code });
}

/**
 * Захватить строку на проверку. Возвращает отметку захвата (grading_started_at), null — её уже
 * проверяет другой запрос или она не в том статусе.
 */
async function claim(id: string): Promise<string | null> {
  const staleBefore = new Date(Date.now() - STALE_GRADING_SEC * 1000).toISOString();
  const claimedAt = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("homework_submissions")
    .update({ status: "grading", grading_started_at: claimedAt })
    .eq("id", id)
    .in("status", ["submitted", "grading"])
    .is("ai_error", null)
    .is("superseded_at", null)
    .or(`grading_started_at.is.null,grading_started_at.lt.${staleBefore}`)
    .select("id");
  if (error) throw new Error(`homework.grade claim failed (${error.code})`);
  return (data?.length ?? 0) > 0 ? claimedAt : null;
}

/** Записать прогресс по частям и продлить захват. null — захват перехватили (дальше не работаем). */
async function saveProgress(id: string, claimedAt: string, state: GradingState): Promise<string | null> {
  const next = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("homework_submissions")
    .update({ grading_progress: state as unknown as Json, grading_started_at: next })
    .eq("id", id)
    .eq("status", "grading")
    .eq("grading_started_at", claimedAt)
    .select("id");
  if (error) throw new Error(`homework.grade progress save failed (${error.code})`);
  return (data?.length ?? 0) > 0 ? next : null;
}

/** Отпустить строку: следующий опрос сразу продолжит проверку (не ждёт STALE_GRADING_SEC). */
async function release(id: string, claimedAt: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("homework_submissions")
    .update({ grading_started_at: null })
    .eq("id", id)
    .eq("status", "grading")
    .eq("grading_started_at", claimedAt);
  if (error) console.error("homework.grade: release failed", { code: error.code });
}

type Loaded = { ok: true; work: WorkForGrading } | { ok: false; error: AiFailCode };

async function loadWork(row: HomeworkRow): Promise<Loaded> {
  const base: WorkForGrading = {
    kind: row.kind,
    fileName: row.file_name,
    linkUrl: row.link_url,
    text: null,
    note: null,
    slides: null,
    pages: null,
    truncated: false,
  };
  if (row.kind === "text") return { ok: true, work: { ...base, text: row.text_body } };
  if (row.kind === "link") return { ok: true, work: { ...base, note: row.text_body } };

  const ext = extOfPath(row.storage_path);
  if (!ext || !row.storage_path) return { ok: false, error: "unreadable" };
  // картинка, видео, звук с результатами из галереи: файл модель не видит, проверяет остальное
  if (fileClass(ext) !== "document") return { ok: true, work: { ...base, note: row.text_body, fileUnseen: true } };
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).download(row.storage_path);
  if (error || !data) {
    console.error("homework.grade: download failed", { message: error?.message });
    return { ok: false, error: "download_failed" };
  }
  if (data.size > MAX_EXTRACT_BYTES) return { ok: false, error: "unreadable" };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const extracted = await extractHomeworkText(bytes, ext);
  if (!extracted) return { ok: false, error: "unreadable" };
  if (!extracted.ok) {
    // в файле нет текста (слайды-картинки, скан), но есть комментарий — проверяем по нему, модель предупреждена
    if (extracted.error === "empty" && row.text_body?.trim()) return { ok: true, work: { ...base, note: row.text_body, fileTextMissing: true } };
    return { ok: false, error: extracted.error };
  }
  const { text, slides, pages, truncated } = extracted.content;
  return { ok: true, work: { ...base, text, note: row.text_body, slides, pages, truncated } };
}

/** Один промпт оценки: ответ модели → оценка (повтор, если не JSON). */
async function gradeOnce(prompt: string): Promise<{ ok: true; parsed: ParsedGrade; model: string | null } | { ok: false; error: AiFailCode }> {
  let model: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({
      prompt: attempt === 0 ? prompt : prompt + RETRY_SUFFIX,
      system: GRADE_SYSTEM_PROMPT,
      maxTokens: GRADE_MAX_TOKENS,
    });
    if (!result.ok) {
      console.error("homework.grade: gateway failed", { error: result.error.slice(0, 120), attempt });
      return { ok: false, error: "gateway" };
    }
    model = result.model ?? null;
    const parsed = parseGradeJson(result.text);
    if (parsed) return { ok: true, parsed, model };
  }
  return { ok: false, error: "bad_json" };
}

type GradeOutcome =
  | { kind: "graded"; parsed: ParsedGrade; model: string | null; passes: { read: number; all: number } | null }
  | { kind: "failed"; error: AiFailCode }
  | { kind: "paused" };

/**
 * Длинная работа: заметки по частям (с продолжением между опросами), потом оценка по заметкам.
 * paused — время запроса кончилось или захват перехвачен: строка отпущена, продолжит следующий опрос.
 */
async function gradeInPasses(
  row: HomeworkRow,
  claimedAt: string,
  lesson: RubricLesson,
  work: WorkForGrading,
  startedAt: number,
): Promise<GradeOutcome> {
  const plan = planPasses(gradingMaterial(work));
  let state = resumeState(row.grading_progress, plan);
  let claimTs = claimedAt;
  let calls = 0;
  const outOfTime = () => calls > 0 && Date.now() - startedAt > STEP_START_LIMIT_MS;

  while (state.notes.length < state.total) {
    if (outOfTime()) {
      await release(row.id, claimTs);
      return { kind: "paused" };
    }
    const index = state.notes.length;
    const result = await generateText({
      prompt: buildNotesPrompt(lesson, plan.chunks[index], index, plan.all),
      system: NOTES_SYSTEM_PROMPT,
      maxTokens: NOTES_MAX_TOKENS,
    });
    calls++;
    const notes = result.ok ? parseNotes(result.text) : null;
    if (!notes) {
      if (!result.ok) console.error("homework.grade: notes gateway failed", { error: result.error.slice(0, 120), part: index + 1 });
      state = { ...state, failures: state.failures + 1 };
      if (state.failures >= MAX_NOTE_FAILURES) return { kind: "failed", error: result.ok ? "bad_json" : "gateway" };
      const saved = await saveProgress(row.id, claimTs, state);
      if (saved) await release(row.id, saved);
      return { kind: "paused" };
    }
    state = { ...state, notes: [...state.notes, notes], failures: 0 };
    const saved = await saveProgress(row.id, claimTs, state);
    if (!saved) return { kind: "paused" }; // строку перехватил другой запрос — он и продолжит
    claimTs = saved;
  }

  if (outOfTime()) {
    await release(row.id, claimTs);
    return { kind: "paused" };
  }
  const graded = await gradeOnce(buildGradePromptFromNotes(lesson, work, state.notes, plan.all, plan.chars));
  if (!graded.ok) return { kind: "failed", error: graded.error };
  return {
    kind: "graded",
    parsed: honestSummary(graded.parsed, state.notes.length, plan.all),
    model: graded.model,
    passes: { read: state.notes.length, all: plan.all },
  };
}

/**
 * Проверить сдачу моделью и записать оценку. Безопасно вызывать повторно и параллельно:
 * строку захватывает один вызов, остальные выходят сразу. Длинную работу один вызов
 * продвигает на одну или несколько частей; доводят её следующие вызовы (опрос браузера).
 */
export async function gradeSubmission(id: string, options: { startedAt?: number } = {}): Promise<void> {
  const startedAt = options.startedAt ?? Date.now();
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("homework_submissions").select("*").eq("id", id).maybeSingle<HomeworkRow>();
  if (error) throw new Error(`homework.grade load failed (${error.code})`);
  if (!row || row.superseded_at || (row.status !== "submitted" && row.status !== "grading")) return;

  const readable = aiCanRead(row);
  if (!readable.ok) {
    if (row.status === "submitted" && !row.ai_error) await markSkipped(id, readable.skip);
    return;
  }
  const claimedAt = await claim(id);
  if (!claimedAt) return;

  const lessonData = getLessonById(row.lesson_id);
  if (!lessonData) return markFailed(id, "lesson_missing");
  const lesson: RubricLesson = { n: lessonData.n, title: lessonData.title, homework: lessonData.homework };

  let loaded: Loaded;
  try {
    loaded = await loadWork(row);
    if (loaded.ok && attachmentIds(row.attachments).length) {
      const views = await loadAttachments(row.user_id, row.attachments, { sign: false });
      loaded = { ok: true, work: { ...loaded.work, attachments: attachmentsForGrading(views) } };
    }
  } catch (cause) {
    console.error("homework.grade: load work failed", { message: cause instanceof Error ? cause.message : String(cause) });
    loaded = { ok: false, error: "server_error" };
  }
  if (!loaded.ok) return markFailed(id, loaded.error);
  const work = loaded.work;

  let outcome: GradeOutcome;
  if (fitsOnePrompt(lesson, work)) {
    const graded = await gradeOnce(buildGradePrompt(lesson, work));
    outcome = graded.ok ? { kind: "graded", parsed: graded.parsed, model: graded.model, passes: null } : { kind: "failed", error: graded.error };
  } else {
    outcome = await gradeInPasses(row, claimedAt, lesson, work, startedAt);
  }
  if (outcome.kind === "paused") return;
  if (outcome.kind === "failed") return markFailed(id, outcome.error);

  const { parsed, model, passes } = outcome;
  const { error: saveError } = await admin
    .from("homework_submissions")
    .update({
      status: "graded",
      ai_score: parsed.score,
      ai_feedback: parsed.feedback as unknown as Json,
      ai_model: model,
      ai_error: null,
      graded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "grading");
  if (saveError) throw new Error(`homework.grade save failed (${saveError.code})`);

  await audit({
    actorId: null,
    action: "homework.graded",
    targetUser: row.user_id,
    targetGroup: row.group_id,
    meta: {
      submission: id,
      lesson: row.lesson_id,
      kind: row.kind,
      score: parsed.score,
      model,
      ...(passes ? { parts: passes.read, partsAll: passes.all } : {}),
      ...(work.attachments?.length ? { attachments: work.attachments.length } : {}),
    },
  });
}
