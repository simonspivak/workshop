// Домашки: типы и тексты, общие для сервера и браузера. Секретов и серверной логики нет.

export type HomeworkKind = "file" | "text" | "link";
export type HomeworkStatus = "uploading" | "submitted" | "grading" | "graded" | "failed";

/** Вердикт по критерию — так, как его пишет модель и видит ученик. */
export type CriterionVerdict = "да" | "частично" | "нет";

export type HomeworkAiFeedback = {
  criteria: { name: string; verdict: CriterionVerdict; note: string }[];
  summary: string;
  tips: string[];
};

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
  createdAt: string;
};

/** Лимит файла домашки — потолок бакета media (50 МБ). */
export const MAX_HOMEWORK_BYTES = 50 * 1024 * 1024;
export const MAX_HOMEWORK_TEXT = 20_000;
/** Комментарий ученика: сюда помещается вся переписка с ИИ; в базе поле text_body ≤ 20 000. */
export const MAX_HOMEWORK_NOTE = 20_000;
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
  empty_text: "Напишите текст работы.",
  no_group: "Сдавать домашку могут ученики группы.",
  already_submitting: "Сдача уже идёт в другом окне. Обновите страницу.",
  teacher_score_required: "Поставьте оценку от 1 до 10.",
} as const;

export type HomeworkErrorCode = keyof typeof homeworkErrorMessages;

export const AI_SKIPS_MEDIA_NOTE = "ИИ пока не читает картинки, видео и звук — оценит ведущий.";
export const AI_SKIPS_LARGE_NOTE = "Файл слишком большой для проверки ИИ — оценит ведущий.";
export const AI_FAILED_NOTE = "ИИ не смог проверить работу — оценит ведущий.";

/** Размер файла по-русски: «1,2 МБ», «340 КБ». */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
