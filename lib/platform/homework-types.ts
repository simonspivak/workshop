// Домашки: типы и тексты, общие для сервера и браузера. Секретов и серверной логики нет.

import type { JobAction, MediaKind } from "@/lib/platform/generation-types";

export type HomeworkKind = "file" | "text" | "link";
export type HomeworkStatus = "uploading" | "submitted" | "grading" | "graded" | "failed";

/** Вердикт по критерию — так, как его пишет модель и видит ученик. */
export type CriterionVerdict = "да" | "частично" | "нет";

export type HomeworkAiFeedback = {
  criteria: { name: string; verdict: CriterionVerdict; note: string }[];
  summary: string;
  tips: string[];
};

/**
 * Результат из галереи, прикреплённый к сдаче (jobs.id). deleted — ученик удалил результат
 * после сдачи (или его скрыл ведущий — для ученика): показываем «результат удалён».
 */
export type HomeworkAttachmentView = {
  jobId: string;
  deleted: boolean;
  /** ведущий скрыл результат: ученик видит пометку вместо файла */
  hidden: boolean;
  action: JobAction | null;
  kind: MediaKind | null;
  /** подпись модели из прайса (или id модели) */
  model: string | null;
  prompt: string | null;
  durationSec: number | null;
  /** подписанная ссылка (час) */
  url: string | null;
  createdAt: string | null;
};

/** Проверка длинной работы по частям: сколько прочитано и сколько всего читается. */
export type HomeworkGradingProgress = { done: number; total: number };

/** Сдача домашки в том виде, в каком она уходит в браузер (ученику или ведущему). */
export type HomeworkView = {
  id: string;
  lessonId: string;
  kind: HomeworkKind;
  status: HomeworkStatus;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  /** подписанная ссылка на файл (час), если файл загружен */
  fileUrl: string | null;
  linkUrl: string | null;
  /** текст работы (kind = text) */
  text: string | null;
  /** комментарий к файлу или ссылке */
  note: string | null;
  ai: { score: number; feedback: HomeworkAiFeedback; model: string | null } | null;
  /** почему оценки ИИ нет: модель не читает такой формат, проверка не удалась… */
  aiNote: string | null;
  teacher: { score: number; comment: string | null; gradedAt: string } | null;
  /** результаты из галереи, прикреплённые к сдаче */
  attachments: HomeworkAttachmentView[];
  /** длинная работа: ИИ читает её по частям (только пока status = grading) */
  progress: HomeworkGradingProgress | null;
  createdAt: string;
};

/** Лимит файла домашки — потолок бакета media (50 МБ). */
export const MAX_HOMEWORK_BYTES = 50 * 1024 * 1024;
/** Текст работы: в базе text_body ≤ 100 000. Длинные работы ИИ читает по частям. */
export const MAX_HOMEWORK_TEXT = 100_000;
/** Комментарий ученика: сюда помещается вся переписка с ИИ; в базе поле text_body ≤ 100 000. */
export const MAX_HOMEWORK_NOTE = 100_000;
/** Сколько результатов из галереи можно прикрепить к одной сдаче (в базе тоже ≤ 20). */
export const MAX_HOMEWORK_ATTACHMENTS = 20;
/** Комментарий ведущего: в базе teacher_comment ≤ 2 000. */
export const MAX_TEACHER_COMMENT = 2_000;
export const MAX_HOMEWORK_LINK = 500;

/** Расширения файлов, которые принимает домашка (тип определяется по расширению, не по браузеру). */
export const HOMEWORK_EXTENSIONS = ["pdf", "pptx", "docx", "png", "jpg", "jpeg", "webp", "mp4", "mp3", "m4a", "wav", "txt", "md"] as const;
export type HomeworkExt = (typeof HOMEWORK_EXTENSIONS)[number];

export const HOMEWORK_ACCEPT = HOMEWORK_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const homeworkKindLabels: Record<HomeworkKind, string> = {
  file: "Файл",
  text: "Текст",
  link: "Ссылка",
};

export const homeworkStatusLabels: Record<HomeworkStatus, string> = {
  uploading: "загружается",
  submitted: "сдано",
  grading: "проверяется",
  graded: "проверено",
  failed: "ИИ не проверил",
};

/** Коды ошибок сдачи домашки (дополняют messages.ts и generation-messages.ts). */
export const homeworkErrorMessages = {
  homework_not_found: "Эта сдача не найдена. Обновите страницу.",
  bad_file_type: "Такой файл не принимается. Подойдут: PDF, PPTX, DOCX, PNG, JPG, WEBP, MP4, MP3, M4A, WAV, TXT, MD.",
  file_too_large: "Файл больше 50 МБ. Сожмите его или загрузите в облако и сдайте ссылку.",
  upload_missing: "Файл не долетел до хранилища. Попробуйте ещё раз.",
  upload_failed: "Не удалось загрузить файл. Проверьте интернет и попробуйте ещё раз.",
  upload_rejected: "Хранилище не приняло файл. Повторять не нужно: напишите ведущему, какой файл вы отправляли.",
  bad_file: "Файл повреждён или это не тот формат, что в названии.",
  bad_link: "Нужна ссылка, которая начинается с https://.",
  empty_text: "Напишите текст работы или прикрепите результаты из галереи.",
  text_too_long: "Текст длиннее 100 000 знаков. Сократи его или сдай файлом.",
  bad_attachments: "Не получилось прикрепить результаты из галереи: какие-то удалены или ещё не готовы. Выбери заново.",
  no_group: "Сдавать домашку могут ученики группы.",
  already_submitting: "Сдача уже идёт в другом окне. Обновите страницу.",
  teacher_score_required: "Поставьте оценку от 1 до 10.",
} as const;

export type HomeworkErrorCode = keyof typeof homeworkErrorMessages;

export const AI_SKIPS_MEDIA_NOTE = "ИИ пока не читает картинки, видео и звук — оценит ведущий.";
export const AI_SKIPS_LARGE_NOTE = "Файл слишком большой для проверки ИИ — оценит ведущий.";
export const AI_FAILED_NOTE = "ИИ не смог проверить работу — оценит ведущий.";
export const AI_EMPTY_FILE_NOTE =
  "В файле не нашлось текста: похоже, слайды сохранены как картинки. Оценит ведущий. Чтобы ИИ проверил, сдай заново и напиши в комментарии, что на слайдах.";

/** Подпись прогресса проверки по частям: «ИИ читает работу: часть 3 из 7» / «ИИ ставит оценку…». */
export function gradingProgressText(progress: HomeworkGradingProgress | null): string {
  if (!progress || progress.total <= 1) return "ИИ проверяет работу…";
  if (progress.done >= progress.total) return "ИИ прочитал всю работу и ставит оценку…";
  return `ИИ читает работу: часть ${progress.done + 1} из ${progress.total}`;
}

/** Размер файла по-русски: «1,2 МБ», «340 КБ». */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
