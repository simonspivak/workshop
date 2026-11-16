import {
  AI_EMPTY_FILE_NOTE,
  AI_IMAGE_UNSEEN_NOTE,
  AI_SEES_IMAGES,
  AI_SKIPS_AV_NOTE,
  AI_SKIPS_IMAGE_NOTE,
  AI_SLIDES_AS_IMAGES_TIP,
  MAX_GRADING_IMAGES,
} from "@/lib/platform/homework-types";
import { extOfPath, fileClass } from "./files";
import { oneLine } from "./rubric";

/*
  Картинки для проверки домашки (docs/platform/spec.md §4.1). Чистый модуль (без базы и сети),
  его проверяют юнит-тесты. Модели уходят не больше MAX_GRADING_IMAGES картинок: сначала
  загруженный файл работы (png/jpg/webp), потом картинки из галереи (image, image_edit) —
  новые первыми. Видео из галереи модель не смотрит, кадры из него не вырезаются.
*/

/** Больше этого загруженную картинку модели не отдаём (наш порог: лимиты kie не документированы). */
export const MAX_GRADING_IMAGE_BYTES = 20 * 1024 * 1024;
/** Сколько знаков промпта результата из галереи в подписи картинки. */
export const IMAGE_CAPTION_PROMPT_CHARS = 100;

export type UploadedImage = { path: string; fileName: string | null };
export type GalleryImage = { jobId: string; path: string; prompt: string | null; createdAt: string | null };

/** Картинка по порядку отправки: путь в бакете media, подпись для промпта, id задачи (для галереи). */
export type GradingImage = { path: string; caption: string; jobId: string | null };

export function uploadCaption(fileName: string | null): string {
  return `файл работы «${oneLine(fileName ?? "без имени", 120)}»`;
}

export function galleryCaption(prompt: string | null): string {
  const text = prompt?.trim() ? oneLine(prompt, IMAGE_CAPTION_PROMPT_CHARS) : "без промпта";
  return `результат из галереи: «${text}»`;
}

/** Порядок и предел: файл работы первым, потом картинки из галереи от новых к старым, всего ≤ max. */
export function pickGradingImages(
  upload: UploadedImage | null,
  gallery: readonly GalleryImage[],
  max = MAX_GRADING_IMAGES,
): GradingImage[] {
  const list: GradingImage[] = [];
  if (upload) list.push({ path: upload.path, caption: uploadCaption(upload.fileName), jobId: null });
  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  const newest = [...gallery].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const seen = new Set(list.map((image) => image.path));
  for (const item of newest) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    list.push({ path: item.path, caption: galleryCaption(item.prompt), jobId: item.jobId });
  }
  return list.slice(0, Math.max(0, max));
}

/** grading_progress.noImages: прошлый вызов с картинками не удался — дальше проверяем без них. */
export function imagesFailedBefore(progress: unknown): boolean {
  return Boolean(progress && typeof progress === "object" && (progress as { noImages?: unknown }).noImages === true);
}

/** Пометка «оценит ведущий» для медиафайла, который ИИ не проверил (ai_error = media). */
export function mediaSkipNote(storagePath: string | null, vision = AI_SEES_IMAGES): string {
  const ext = extOfPath(storagePath);
  if (ext && fileClass(ext) === "image") return vision ? AI_IMAGE_UNSEEN_NOTE : AI_SKIPS_IMAGE_NOTE;
  return AI_SKIPS_AV_NOTE;
}

/** Файл без текста (слайды-картинки): что сделать, чтобы ИИ проверил. */
export function emptyFileNote(vision = AI_SEES_IMAGES): string {
  return vision ? `${AI_EMPTY_FILE_NOTE} ${AI_SLIDES_AS_IMAGES_TIP}` : AI_EMPTY_FILE_NOTE;
}
