import type { JobAction, JobStatus } from "@/lib/platform/generation-types";
import { MAX_HOMEWORK_ATTACHMENTS, type HomeworkAttachmentView } from "@/lib/platform/homework-types";
import type { AttachmentForGrading } from "./rubric";

/*
  Результаты из галереи в домашке: правила без базы и сети (юнит-тесты).
  Прикрепить можно только свой готовый, не удалённый и не скрытый ведущим результат-медиа
  (картинка, видео, озвучка, музыка, монтаж), не больше MAX_HOMEWORK_ATTACHMENTS, без повторов.
*/

export const ATTACHABLE_ACTIONS: readonly JobAction[] = ["image", "image_edit", "video", "motion", "lipsync", "voice", "music", "montage"];

export type AttachmentJobRow = {
  id: string;
  user_id: string;
  action: JobAction;
  status: JobStatus;
  hidden: boolean;
  deleted_at: string | null;
};

export type AttachmentCheck = { ok: true; ids: string[] } | { ok: false; error: "bad_attachments" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверить выбор ученика по строкам jobs, которые нашлись по этим id.
 * Любое нарушение — отказ целиком: ученик выбирает заново (молча выбрасывать нельзя — он
 * думал бы, что сдал 6 клипов, а сдал 5).
 */
export function checkAttachmentRows(ids: readonly string[], rows: readonly AttachmentJobRow[], userId: string): AttachmentCheck {
  if (ids.length === 0) return { ok: true, ids: [] };
  if (ids.length > MAX_HOMEWORK_ATTACHMENTS) return { ok: false, error: "bad_attachments" };
  const normalized = ids.map((id) => id.toLowerCase());
  if (normalized.some((id) => !UUID_RE.test(id))) return { ok: false, error: "bad_attachments" };
  if (new Set(normalized).size !== normalized.length) return { ok: false, error: "bad_attachments" };
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  for (const id of normalized) {
    const row = byId.get(id);
    if (
      !row ||
      row.user_id !== userId ||
      row.status !== "done" ||
      row.deleted_at !== null ||
      row.hidden ||
      !ATTACHABLE_ACTIONS.includes(row.action)
    ) {
      return { ok: false, error: "bad_attachments" };
    }
  }
  return { ok: true, ids: normalized };
}

/** id из jsonb-колонки attachments (только строки-uuid, по порядку, без повторов). */
export function attachmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)).map((v) => v.toLowerCase());
  return [...new Set(ids)].slice(0, MAX_HOMEWORK_ATTACHMENTS);
}

/** Длительность из jobs.params: видео и музыка — duration, монтаж — durationSec. null — неизвестна. */
export function attachmentDuration(action: JobAction, params: unknown): number | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  const raw = action === "montage" ? p.durationSec : p.duration;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n < 3600 ? n : null;
}

/**
 * Метаданные для промпта проверки: тип, модель, длина и промпт. imageNo — под каким номером
 * картинка этого результата приложена к сообщению (jobId → номер); видео модель не смотрит.
 */
export function attachmentsForGrading(views: HomeworkAttachmentView[], imageNo: ReadonlyMap<string, number> = new Map()): AttachmentForGrading[] {
  return views.map((view) => ({
    action: view.action,
    model: view.model,
    durationSec: view.durationSec,
    prompt: view.prompt,
    deleted: view.deleted,
    ...(imageNo.has(view.jobId) ? { imageNo: imageNo.get(view.jobId) } : {}),
  }));
}
