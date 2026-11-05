// Типы и подписи генераций, галереи и уроков, которые нужны и серверу, и браузеру.
// Только данные (DTO) и константы — без секретов и серверной логики.

export type JobAction = "text" | "image" | "image_edit" | "video" | "motion" | "lipsync" | "voice" | "music" | "montage";
/** Действия, которые запускаются через POST /api/generate (монтаж делает студия в браузере). */
export type GenerateAction = Exclude<JobAction, "montage">;
export type JobStatus = "queued" | "submitted" | "storing" | "done" | "failed";
export type MediaKind = "image" | "video" | "audio";

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "submitted", "storing"];

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

/** Файл результата: подписанная ссылка (живёт час) и путь в хранилище (для референсов). */
export type MediaFile = { url: string; path: string; kind: MediaKind };

/** Задача генерации, как её видит браузер (GET /api/jobs/[id], галерея, урок). */
export type JobView = {
  id: string;
  action: JobAction;
  model: string;
  status: JobStatus;
  stars: number;
  prompt: string | null;
  /** ответ текстовой модели */
  text: string | null;
  media: MediaFile[];
  /** код ошибки (см. generation-messages.ts), только для failed */
  error: string | null;
  hidden: boolean;
  lessonId: string | null;
  taskRef: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Элемент галереи: задача + автор (в галерее группы и у ведущего). */
export type GalleryItem = JobView & { author: string | null; mine: boolean };

/** Готовый файл, который можно подставить как референс. */
export type MediaOption = {
  path: string;
  url: string;
  kind: MediaKind;
  label: string;
  /** из библиотеки курса (драйверы движения) */
  library?: boolean;
  /** задача, из которой файл (озвучка или музыка и т. п.); у библиотеки курса нет */
  action?: JobAction;
};

export const jobActionLabels: Record<JobAction, string> = {
  text: "Текст",
  image: "Картинка",
  image_edit: "Правка картинки",
  video: "Видео",
  motion: "Перенос движения",
  lipsync: "Говорящая голова",
  voice: "Озвучка",
  music: "Музыка",
  montage: "Монтаж",
};

export const jobStatusLabels: Record<JobStatus, string> = {
  queued: "в очереди",
  submitted: "генерируется",
  storing: "сохраняем",
  done: "готово",
  failed: "не получилось",
};

export function mediaKindForAction(action: JobAction): MediaKind | null {
  switch (action) {
    case "image":
    case "image_edit":
      return "image";
    case "video":
    case "motion":
    case "lipsync":
    case "montage":
      return "video";
    case "voice":
    case "music":
      return "audio";
    case "text":
      return null;
  }
}

export const ASPECT_RATIOS = ["9:16", "1:1", "16:9", "3:4", "4:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Голоса Gemini TTS. Проверен на курсе только Puck (см. docs/decisions.md, п. 6). */
export const VOICE_OPTIONS = [
  { id: "Kore", label: "Kore — женский, уверенный" },
  { id: "Puck", label: "Puck — мужской, бодрый" },
  { id: "Charon", label: "Charon — мужской, спокойный, как диктор" },
  { id: "Fenrir", label: "Fenrir — мужской, взволнованный" },
  { id: "Leda", label: "Leda — женский, молодой" },
  { id: "Orus", label: "Orus — мужской, твёрдый" },
  { id: "Aoede", label: "Aoede — женский, лёгкий" },
  { id: "Zephyr", label: "Zephyr — женский, яркий" },
  { id: "Algenib", label: "Algenib — мужской, с хрипотцой" },
  { id: "Gacrux", label: "Gacrux — женский, взрослый" },
  { id: "Sulafat", label: "Sulafat — женский, тёплый" },
  { id: "Achird", label: "Achird — мужской, дружелюбный" },
] as const;
export type VoiceId = (typeof VOICE_OPTIONS)[number]["id"];
export const VOICE_IDS = VOICE_OPTIONS.map((v) => v.id) as [VoiceId, ...VoiceId[]];

/** Почему действие недоступно (коды из messages.ts и generation-messages.ts). */
export type ActionDenied =
  | "unknown_model"
  | "staff_only"
  | "adult_only"
  | "google_minors"
  | "consent_required"
  | "library_empty"
  | "group_paused";

/** Модель для выбора в форме (у ведущего — все модели шлюза). */
export type ModelChoice = { model: string; label: string; stars: number };

/** Кнопка ИИ-действия в задании урока, уже с ценой из прайса и правилами доступа. */
export type GenerateActionOption = {
  key: string;
  action: GenerateAction;
  model: string;
  modelLabel: string;
  /** сколько спишем; 0 у ведущего */
  stars: number;
  /** video: цена ролика 10 секунд */
  longStars: number | null;
  /** text: длинный ответ (до 2000 токенов) */
  long: boolean;
  available: boolean;
  reason: ActionDenied | null;
  /** выбор модели — только у ведущего (демо-режим) */
  models: ModelChoice[];
};
