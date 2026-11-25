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
  /** звук: начало реплики или название трека — чтобы выбирать не вслепую */
  text?: string;
  /**
   * Длина в секундах: образец движения из библиотеки — по заголовку MP4 (lib/server/motion-driver.ts),
   * озвучка — по заголовку WAV (lib/server/storage.ts, voiceSecondsFor).
   * null — длину узнать не удалось; поля нет — не проверяли.
   */
  seconds?: number | null;
};

// ---------- перенос движения: длина образца ----------

/**
 * Потолок длины видео-образца (драйвера) для переноса движения, секунды. kie (kling-2.6/motion-control)
 * берёт кредиты за каждую секунду образца и отдаёт ролик той же длины, а цена в звёздах одна
 * (docs/platform/spec.md §3, «Цена и длина»). Проверяет сервер до списания (lib/server/motion-driver.ts),
 * плитка образца в форме показывает длину и гасится, если образец длиннее.
 */
export const MOTION_DRIVER_MAX_SEC = 10;
/** Допуск к потолку: ролик, обрезанный до 10 с, бывает 10,0–10,1 с из-за последнего кадра и звука. */
export const MOTION_DRIVER_TOLERANCE_SEC = 0.5;

export type MotionDriverVerdict = "ok" | "too_long" | "unknown";

/**
 * Можно ли брать образец такой длины. Длиннее потолка — нельзя никому. seconds null — длина
 * неизвестна: можно (см. MOTION_DRIVER_BLOCK_UNKNOWN), сервер пишет предупреждение в лог.
 */
/**
 * Запрещать ли ученику образец, длину которого не удалось измерить. Выключено: библиотеку наполняет
 * ведущий, а измерение зависит от ответа Storage на Range-запросы — сбой измерения не должен
 * выключать «Перенос движения» всей группе. Включить, когда на проде видно, что длина меряется стабильно.
 */
export const MOTION_DRIVER_BLOCK_UNKNOWN = false;

export function motionDriverVerdict(seconds: number | null | undefined, staff: boolean): MotionDriverVerdict {
  if (seconds === null || seconds === undefined) return staff || !MOTION_DRIVER_BLOCK_UNKNOWN ? "ok" : "unknown";
  return seconds > MOTION_DRIVER_MAX_SEC + MOTION_DRIVER_TOLERANCE_SEC ? "too_long" : "ok";
}

/** «10 с», «7 с»: длина образца или озвучки на плитке. */
export function formatDriverSeconds(seconds: number): string {
  return `${Math.max(1, Math.round(seconds))} с`;
}

// ---------- говорящая голова: длина озвучки ----------

/**
 * Потолок длины озвучки для «говорящей головы» у ученика, секунды. Одна константа на всё: проверка
 * сервера (lib/server/storage.ts), плитки выбора озвучки, тексты ошибок, урок 3 и docs/platform/spec.md.
 * Модель (kling/ai-avatar-standard) принимает до 5 минут, но kie берёт ≈ 8,7 кредита за секунду аудио,
 * а цена в звёздах одна (spec.md §3, «Цена и длина» у говорящей головы). Ведущему потолка нет.
 */
export const STUDENT_LIPSYNC_MAX_SEC = 20;
/** Допуск: TTS докидывает к фразе тишину в конце, 20,4 с — это ещё «20 секунд». */
export const STUDENT_LIPSYNC_TOLERANCE_SEC = 0.5;

/** Можно ли взять озвучку такой длины. Неизвестная длина — можно: решает проверка сервера. */
export function lipsyncAudioVerdict(seconds: number | null | undefined, staff: boolean): "ok" | "too_long" {
  if (staff || seconds === null || seconds === undefined) return "ok";
  return seconds > STUDENT_LIPSYNC_MAX_SEC + STUDENT_LIPSYNC_TOLERANCE_SEC ? "too_long" : "ok";
}

// ---------- музыка: длина трека и голос ----------

/**
 * Длина трека Suno, секунды (поле duration шлюза). Только для custom-режима: без вокала или со своим
 * текстом песни. В простом режиме («опиши песню») Suno длину и голос не принимает.
 */
export const MUSIC_DURATION_OPTIONS = [
  { seconds: 30, label: "30 с" },
  { seconds: 60, label: "1 мин" },
  { seconds: 90, label: "1,5 мин" },
  { seconds: 120, label: "2 мин" },
] as const;
export const MUSIC_DEFAULT_DURATION = 60;
export const MUSIC_MAX_DURATION = 120;

/** Голос певца (vocal_gender у Suno): только для песни со своим текстом. */
export const MUSIC_VOCAL_OPTIONS = [
  { id: "any", label: "Любой" },
  { id: "m", label: "Мужской" },
  { id: "f", label: "Женский" },
] as const;
export type MusicVocal = (typeof MUSIC_VOCAL_OPTIONS)[number]["id"];

/** Custom-режим Suno: без вокала или со своим текстом. Только в нём работают длина и голос. */
export function musicCustomMode(input: { instrumental?: boolean; lyrics?: string | null }): boolean {
  return input.instrumental === true || Boolean(input.lyrics?.trim());
}

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

/** Вторая модель озвучки (26 ноября 2026): эмоции задают тегами в тексте, поля «Манера речи» у неё нет. */
export const ELEVEN_VOICE_MODEL = "elevenlabs/text-to-dialogue-v3";

/** Голоса ElevenLabs V3 на kie (docs.kie.ai/market/elevenlabs/text-to-dialogue-v3.md). Шлюз меняет имя на ID голоса. */
export const ELEVEN_VOICE_OPTIONS = [
  { id: "Sarah", label: "Sarah — женский, взрослый, уверенный" },
  { id: "Liam", label: "Liam — мужской, энергичный, блогер" },
  { id: "Daniel", label: "Daniel — мужской, ровный, как диктор" },
  { id: "Alice", label: "Alice — женский, ясный, как учитель" },
  { id: "George", label: "George — мужской, тёплый рассказчик" },
  { id: "Jessica", label: "Jessica — женский, игривый, тёплый" },
  { id: "Adam", label: "Adam — мужской, твёрдый" },
  { id: "Bill", label: "Bill — мужской, зрелый, мудрый" },
  { id: "Brian", label: "Brian — мужской, низкий, спокойный" },
  { id: "Callum", label: "Callum — мужской, с хрипотцой" },
  { id: "Charlie", label: "Charlie — мужской, уверенный, бодрый" },
  { id: "Chris", label: "Chris — мужской, простой, обаятельный" },
  { id: "Eric", label: "Eric — мужской, мягкий, надёжный" },
  { id: "Harry", label: "Harry — мужской, резкий, воин" },
  { id: "Laura", label: "Laura — женский, задорный" },
  { id: "Lily", label: "Lily — женский, бархатный, актриса" },
  { id: "Matilda", label: "Matilda — женский, деловой" },
  { id: "River", label: "River — нейтральный, спокойный" },
  { id: "Roger", label: "Roger — мужской, расслабленный" },
  { id: "Will", label: "Will — мужской, спокойный оптимист" },
] as const;

export type VoiceId = (typeof VOICE_OPTIONS)[number]["id"] | (typeof ELEVEN_VOICE_OPTIONS)[number]["id"];
export const VOICE_IDS = [...VOICE_OPTIONS, ...ELEVEN_VOICE_OPTIONS].map((v) => v.id) as [VoiceId, ...VoiceId[]];

/** Список голосов модели озвучки. */
export function voiceOptionsFor(model: string): readonly { id: VoiceId; label: string }[] {
  return model === ELEVEN_VOICE_MODEL ? ELEVEN_VOICE_OPTIONS : VOICE_OPTIONS;
}

/** Голос для модели: выбранный, если он из её списка, иначе первый в списке (Kore или Sarah). */
export function voiceForModel(model: string, voice: string | null | undefined): VoiceId {
  const list = voiceOptionsFor(model);
  return list.find((v) => v.id === voice)?.id ?? list[0].id;
}

/** Умеет ли модель озвучки отдельное поле «Манера речи» (Gemini — да, ElevenLabs — нет: теги в тексте). */
export function voiceTakesStyle(model: string): boolean {
  return model !== ELEVEN_VOICE_MODEL;
}

/**
 * Теги эмоций ElevenLabs V3 для кнопок под полем реплики. Тег — английское слово в квадратных скобках:
 * голос его не читает, а играет. Действует на слова после себя.
 */
export const ELEVEN_TAGS = [
  { tag: "[excitedly]", label: "радостно" },
  { tag: "[calm]", label: "спокойно" },
  { tag: "[serious]", label: "серьёзно" },
  { tag: "[curious]", label: "с интересом" },
  { tag: "[sarcastic]", label: "с иронией" },
  { tag: "[sad]", label: "грустно" },
  { tag: "[whispers]", label: "шёпотом" },
  { tag: "[laughs]", label: "смех" },
  { tag: "[sighs]", label: "вздох" },
  { tag: "[short pause]", label: "пауза" },
] as const;

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
