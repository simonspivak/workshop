// DTO студии монтажа: общие для сервера (lib/server/studio.ts, /api/studio/*) и браузера.
// Только типы и константы, без секретов.

export type StudioMediaKind = "video" | "image" | "voice" | "music";

export type StudioMediaItem = {
  /** id задачи; у второго трека музыки — `${jobId}:2` */
  id: string;
  jobId: string;
  kind: StudioMediaKind;
  /** подписанная ссылка Storage на час */
  url: string;
  /** расширение файла: mp4, jpg, png, webp, mp3, wav, m4a */
  ext: string;
  mimeType: string | null;
  /** короткая подпись: начало промпта или название трека */
  title: string;
  /** текст реплики (только voice) — из него субтитр */
  text: string | null;
  /** голос озвучки, если известен */
  voice: string | null;
  /** длительность, если известна по параметрам задачи, с */
  duration: number | null;
  /**
   * клип «Говорящая голова» (задача lipsync): губы сделаны по реплике с 0 с, поэтому реплика
   * в этой сцене звучит без обычной задержки 0,3 с
   */
  talking: boolean;
  createdAt: string;
  /** своя генерация или из общей галереи группы */
  own: boolean;
  /** ник автора (для чужих) */
  author: string | null;
};

export type StudioMediaResponse = {
  items: StudioMediaItem[];
  me: { nickname: string };
  /** учитель включил общую галерею группы */
  shareGallery: boolean;
  /** когда истекут ссылки (ISO) */
  expiresAt: string;
};

export type StudioSaveRequest = {
  idempotencyKey: string;
  /** только проверить тексты (модерация) до монтажа, задачу не создавать */
  dryRun?: boolean;
  title: string;
  authors: string;
  subtitles: string[];
  scenes?: { jobId: string; lineJobId: string | null }[];
  musicJobId?: string | null;
  durationSec?: number;
  sizeBytes?: number;
  lessonId?: string | null;
  taskRef?: string | null;
};

export type StudioSaveResponse =
  | { ok: true; dryRun: true }
  | {
      ok: true;
      dryRun?: false;
      jobId: string;
      /** уже загружено и сохранено раньше (повтор с тем же ключом) */
      done: boolean;
      /** PUT сюда (подписанная ссылка Storage на загрузку, живёт 2 часа) */
      uploadUrl: string | null;
      /** публичный ключ Supabase для заголовка apikey (как у supabase-js) */
      apiKey: string | null;
      maxBytes: number;
    }
  | { ok: false; error: string; field?: string };

export type StudioCompleteResponse = { ok: true; status: "done" | "failed" } | { ok: false; error: string };

/** Лимит размера готового ролика (бакет media — 50 МБ). */
export const MAX_MONTAGE_BYTES = 50 * 1024 * 1024;
