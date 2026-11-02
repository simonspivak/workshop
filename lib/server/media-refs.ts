import "server-only";
import type { MediaKind } from "@/lib/platform/generation-types";

/*
  Пути файлов в бакете media и проверка того, что прислал браузер как референс.
  Ученик присылает только пути к своим результатам ({user_id}/{job_id}.{ext}) или к библиотеке
  курса (library/…). Внешние ссылки принимаются только от ведущего.
  Модуль без ввода-вывода; доступ к задаче проверяет lib/server/storage.ts.
*/

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXT = "jpg|png|webp|mp4|mp3|wav|m4a";

const JOB_MEDIA_PATH_RE = new RegExp(`^(${UUID})/(${UUID})(?:-([2-9]|1[0-9]))?\\.(${EXT})$`);
const LIBRARY_PATH_RE = new RegExp(`^library/(?:[a-z0-9][a-z0-9_-]{0,60}/){1,3}[a-z0-9][a-z0-9_-]{0,80}\\.(${EXT})$`);

const KIND_BY_EXT: Record<string, MediaKind> = {
  jpg: "image",
  png: "image",
  webp: "image",
  mp4: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
};

export type JobMediaPath = { userId: string; jobId: string; ext: string };

export function parseJobMediaPath(path: string): JobMediaPath | null {
  const match = JOB_MEDIA_PATH_RE.exec(path);
  if (!match) return null;
  return { userId: match[1], jobId: match[2], ext: match[4] };
}

export function isLibraryPath(path: string): boolean {
  return LIBRARY_PATH_RE.test(path);
}

export function mediaKindOfPath(path: string): MediaKind | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return KIND_BY_EXT[ext] ?? null;
}

/** Ссылка, которую ведущий может передать шлюзу напрямую: https, без логина и пароля в адресе. */
export function isAcceptableExternalUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Поля запроса с файлами и какой тип файла в каждом ожидается. */
export const REFERENCE_SLOTS = {
  images: "image",
  videos: "video",
  audios: "audio",
  video: "video",
  audio: "audio",
} as const satisfies Record<string, MediaKind>;

export type ReferenceSlot = keyof typeof REFERENCE_SLOTS;

export type ReferenceInput = {
  images?: string[];
  videos?: string[];
  audios?: string[];
  video?: string;
  audio?: string;
};

export type ClassifiedReference =
  | { slot: ReferenceSlot; value: string; source: "job"; jobId: string; ownerId: string }
  | { slot: ReferenceSlot; value: string; source: "library" }
  | { slot: ReferenceSlot; value: string; source: "url" };

export type ClassifyError = "bad_reference" | "library_only";

/**
 * Разобрать референсы запроса без обращения к базе.
 * libraryOnlyVideo — видео-драйвер (motion) только из библиотеки курса.
 */
export function classifyReferences(
  input: ReferenceInput,
  options: { staff: boolean; libraryOnlyVideo: boolean },
): { ok: true; refs: ClassifiedReference[] } | { ok: false; error: ClassifyError } {
  const refs: ClassifiedReference[] = [];
  for (const slot of Object.keys(REFERENCE_SLOTS) as ReferenceSlot[]) {
    const raw = input[slot];
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const libraryOnly = options.libraryOnlyVideo && slot === "video";
      if (value.startsWith("https://")) {
        if (!options.staff) return { ok: false, error: libraryOnly ? "library_only" : "bad_reference" };
        if (!isAcceptableExternalUrl(value)) return { ok: false, error: "bad_reference" };
        refs.push({ slot, value, source: "url" });
        continue;
      }
      if (mediaKindOfPath(value) !== REFERENCE_SLOTS[slot]) return { ok: false, error: "bad_reference" };
      if (isLibraryPath(value)) {
        refs.push({ slot, value, source: "library" });
        continue;
      }
      if (libraryOnly) return { ok: false, error: "library_only" };
      const parsed = parseJobMediaPath(value);
      if (!parsed) return { ok: false, error: "bad_reference" };
      refs.push({ slot, value, source: "job", jobId: parsed.jobId, ownerId: parsed.userId });
    }
  }
  return { ok: true, refs };
}
