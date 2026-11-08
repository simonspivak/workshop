// Черновик формы генерации одного ИИ-действия задания: голос, манера, формат кадра, выбранные
// референсы и т. п. Живёт в sessionStorage браузера под ключом iis-form:<урок>:<задание>:<действие>,
// чтобы переключение между кнопками действий (скопировать промпт из соседнего чата и вернуться)
// не сбрасывало форму. Сам текст запроса хранится выше, в LessonTaskTools.
// Только данные и чистые функции — без React и без серверного кода.

import { ASPECT_RATIOS, VOICE_IDS, type AspectRatio, type VoiceId } from "@/lib/platform/generation-types";

export type GenerateFormDraft = {
  model: string;
  aspect: AspectRatio;
  images: string[];
  driver: string[];
  voiceTrack: string[];
  referenceMode: boolean;
  duration: number;
  sound: boolean;
  voice: VoiceId;
  style: string;
  instrumental: boolean;
  lyrics: string;
  title: string;
};

/** Что известно форме сейчас: по этому черновик из хранилища проверяется перед восстановлением. */
export type FormDraftContext = {
  /** модели, которые можно выбрать (у ученика — одна) */
  models: readonly string[];
  defaultModel: string;
  /** доступен ли ролик 10 секунд */
  longVideo: boolean;
  /** пути файлов, которые сейчас есть в списках выбора (галерея, корзина референсов, библиотека) */
  imagePaths: readonly string[];
  videoPaths: readonly string[];
  audioPaths: readonly string[];
  /** сколько картинок можно выбрать при этом режиме референсов */
  maxImages: (referenceMode: boolean) => number;
};

export const STYLE_MAX = 300;
export const LYRICS_MAX = 3000;
export const TITLE_MAX = 80;

export function formDraftKey(lessonId: string | undefined, taskId: string | undefined, optionKey: string): string {
  return `iis-form:${lessonId ?? "-"}:${taskId ?? "-"}:${optionKey}`;
}

export function defaultFormDraft(defaultModel: string): GenerateFormDraft {
  return {
    model: defaultModel,
    aspect: "9:16",
    images: [],
    driver: [],
    voiceTrack: [],
    referenceMode: false,
    duration: 5,
    sound: false,
    voice: "Kore",
    style: "",
    instrumental: false,
    lyrics: "",
    title: "",
  };
}

function strings(value: unknown, allowed: readonly string[], max: number): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(allowed);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && known.has(item) && !out.includes(item)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Черновик из хранилища → проверенный черновик. Чужие значения заменяются на умолчания,
 * выбранные файлы остаются, только если они всё ещё есть в списках выбора.
 */
export function sanitizeFormDraft(raw: unknown, ctx: FormDraftContext): GenerateFormDraft {
  const base = defaultFormDraft(ctx.defaultModel);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const referenceMode = r.referenceMode === true;
  return {
    model: typeof r.model === "string" && ctx.models.includes(r.model) ? r.model : base.model,
    aspect: (ASPECT_RATIOS as readonly string[]).includes(r.aspect as string) ? (r.aspect as AspectRatio) : base.aspect,
    images: strings(r.images, ctx.imagePaths, ctx.maxImages(referenceMode)),
    driver: strings(r.driver, ctx.videoPaths, 1),
    voiceTrack: strings(r.voiceTrack, ctx.audioPaths, 1),
    referenceMode,
    duration: r.duration === 10 && ctx.longVideo ? 10 : 5,
    sound: r.sound === true,
    voice: (VOICE_IDS as readonly string[]).includes(r.voice as string) ? (r.voice as VoiceId) : base.voice,
    style: text(r.style, STYLE_MAX),
    instrumental: r.instrumental === true,
    lyrics: text(r.lyrics, LYRICS_MAX),
    title: text(r.title, TITLE_MAX),
  };
}

/** Прочитать черновик из sessionStorage (только в браузере). Нет или битый — умолчания. */
export function readFormDraft(key: string, ctx: FormDraftContext): GenerateFormDraft {
  if (typeof window === "undefined") return defaultFormDraft(ctx.defaultModel);
  try {
    const saved = window.sessionStorage.getItem(key);
    return sanitizeFormDraft(saved ? JSON.parse(saved) : null, ctx);
  } catch {
    return defaultFormDraft(ctx.defaultModel);
  }
}

export function writeFormDraft(key: string, draft: GenerateFormDraft): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // приватный режим или запрет хранилища: форма просто не запомнится
  }
}
