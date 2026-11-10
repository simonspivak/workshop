import "server-only";
import { audit } from "@/lib/server/audit";
import { getLessonById } from "@/lib/server/course";
import { generateText } from "@/lib/server/gateway";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Database, Json } from "@/lib/server/supabase/types";
import { extractHomeworkText } from "./extract";
import { extOfPath, fileClass } from "./files";
import { buildGradePrompt, GRADE_MAX_TOKENS, GRADE_SYSTEM_PROMPT, parseGradeJson, RETRY_SUFFIX, type WorkForGrading } from "./rubric";

/*
  Автоматическая проверка домашки (docs/platform/spec.md «Домашки»).
    submitted ──claim──▶ grading ──▶ graded (оценка 1–10, критерии, выжимка, советы)
                                 └──▶ failed (модель не ответила или вернула не JSON дважды)
  Картинки, видео, звук и файлы больше MAX_EXTRACT_BYTES модель не читает: строка остаётся
  submitted с ai_error = media | too_large, оценивает ведущий.
  Модель — цепочка generateText (Haiku → Kimi), звёзды ученика не тратятся: платит владелец.
  Захват строки (claim) — одним update со статусом и временем: два одновременных запроса
  (complete и опрос) не проверят работу дважды; зависшую проверку (> STALE_GRADING_SEC)
  следующий опрос перехватывает и проверяет заново.
*/

export type HomeworkRow = Database["public"]["Tables"]["homework_submissions"]["Row"];

/** Больше этого файл из Storage не скачиваем и не читаем (память функции). */
export const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
export const STALE_GRADING_SEC = 90;

/** Почему ИИ не оценил (ai_error): пропуск при статусе submitted или причина failed. */
export type AiSkipCode = "media" | "too_large";
export type AiFailCode = "unreadable" | "empty" | "gateway" | "bad_json" | "lesson_missing" | "download_failed" | "server_error";

/** Модель может прочитать работу (текст, ссылка, документ подходящего размера). */
export function aiCanRead(row: Pick<HomeworkRow, "kind" | "storage_path" | "size_bytes">): { ok: true } | { ok: false; skip: AiSkipCode } {
  if (row.kind !== "file") return { ok: true };
  const ext = extOfPath(row.storage_path);
  if (!ext || fileClass(ext) !== "document") return { ok: false, skip: "media" };
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

/** Захватить строку на проверку. false — её уже проверяет другой запрос или она не в том статусе. */
async function claim(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_GRADING_SEC * 1000).toISOString();
  const { data, error } = await createAdminClient()
    .from("homework_submissions")
    .update({ status: "grading", grading_started_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["submitted", "grading"])
    .is("ai_error", null)
    .is("superseded_at", null)
    .or(`grading_started_at.is.null,grading_started_at.lt.${staleBefore}`)
    .select("id");
  if (error) throw new Error(`homework.grade claim failed (${error.code})`);
  return (data?.length ?? 0) > 0;
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
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).download(row.storage_path);
  if (error || !data) {
    console.error("homework.grade: download failed", { message: error?.message });
    return { ok: false, error: "download_failed" };
  }
  if (data.size > MAX_EXTRACT_BYTES) return { ok: false, error: "unreadable" };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const extracted = await extractHomeworkText(bytes, ext);
  if (!extracted) return { ok: false, error: "unreadable" };
  if (!extracted.ok) return { ok: false, error: extracted.error };
  const { text, slides, pages, truncated } = extracted.content;
  return { ok: true, work: { ...base, text, note: row.text_body, slides, pages, truncated } };
}

/**
 * Проверить сдачу моделью и записать оценку. Безопасно вызывать повторно и параллельно:
 * строку захватывает один вызов, остальные выходят сразу.
 */
export async function gradeSubmission(id: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("homework_submissions").select("*").eq("id", id).maybeSingle<HomeworkRow>();
  if (error) throw new Error(`homework.grade load failed (${error.code})`);
  if (!row || row.superseded_at || (row.status !== "submitted" && row.status !== "grading")) return;

  const readable = aiCanRead(row);
  if (!readable.ok) {
    if (row.status === "submitted" && !row.ai_error) await markSkipped(id, readable.skip);
    return;
  }
  if (!(await claim(id))) return;

  const lesson = getLessonById(row.lesson_id);
  if (!lesson) return markFailed(id, "lesson_missing");

  let loaded: Loaded;
  try {
    loaded = await loadWork(row);
  } catch (cause) {
    console.error("homework.grade: load work failed", { message: cause instanceof Error ? cause.message : String(cause) });
    loaded = { ok: false, error: "server_error" };
  }
  if (!loaded.ok) return markFailed(id, loaded.error);

  const prompt = buildGradePrompt({ n: lesson.n, title: lesson.title, homework: lesson.homework }, loaded.work);
  let model: string | null = null;
  let parsed = null as ReturnType<typeof parseGradeJson>;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const result = await generateText({
      prompt: attempt === 0 ? prompt : prompt + RETRY_SUFFIX,
      system: GRADE_SYSTEM_PROMPT,
      maxTokens: GRADE_MAX_TOKENS,
    });
    if (!result.ok) {
      console.error("homework.grade: gateway failed", { error: result.error.slice(0, 120), attempt });
      return markFailed(id, "gateway");
    }
    model = result.model ?? null;
    parsed = parseGradeJson(result.text);
  }
  if (!parsed) return markFailed(id, "bad_json");

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
    meta: { submission: id, lesson: row.lesson_id, kind: row.kind, score: parsed.score, model },
  });
}
