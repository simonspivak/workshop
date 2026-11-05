import {
  LIMITS,
  MUSIC_LEVEL_DB,
  planMontage,
  type EncodeOptions,
  type MontageSettings,
  type MusicLevel,
  type PlanResult,
  type TitleCard,
} from "./args";
import type { PipelineJob } from "./pipeline";
import type { StudioMediaItem } from "./types";

/*
  Проект монтажа в студии: сцены, реплики, музыка, оформление. Чистые функции:
  предпросмотр плана (длительность до монтажа), сборка задания для движка, черновик в localStorage.
*/

export type StudioScene = {
  key: string;
  mediaId: string;
  lineId: string | null;
  subtitle: string;
  /** ученик правил субтитр руками — не перезаписывать текстом реплики */
  subtitleEdited: boolean;
};

export type StudioDesign = {
  title: string;
  /** null — подставлять ники авторов выбранных медиа */
  authors: string | null;
  titleCard: "none" | "start" | "end";
  label: boolean;
  subtitles: boolean;
  clipAudio: boolean;
  kenBurns: boolean;
  musicLevel: MusicLevel;
};

export type StudioProject = { scenes: StudioScene[]; musicId: string | null; design: StudioDesign };

export const DEFAULT_DESIGN: StudioDesign = {
  title: "",
  authors: null,
  titleCard: "end",
  label: true,
  subtitles: true,
  clipAudio: false,
  kenBurns: true,
  musicLevel: "normal",
};

export const EMPTY_PROJECT: StudioProject = { scenes: [], musicId: null, design: DEFAULT_DESIGN };

export type MediaIndex = ReadonlyMap<string, StudioMediaItem>;

/** Ники авторов выбранных медиа: свой первым, потом остальные по порядку. */
export function defaultAuthors(project: StudioProject, media: MediaIndex, me: string): string {
  const names = [me];
  const ids = [...project.scenes.flatMap((s) => [s.mediaId, s.lineId]), project.musicId];
  for (const id of ids) {
    const author = id ? media.get(id)?.author : null;
    if (author && !names.includes(author)) names.push(author);
  }
  return names.join(", ").slice(0, LIMITS.maxAuthorsChars);
}

export function authorsOf(project: StudioProject, media: MediaIndex, me: string): string {
  return project.design.authors ?? defaultAuthors(project, media, me);
}

function titleCard(project: StudioProject, media: MediaIndex, me: string): TitleCard | null {
  const { design } = project;
  if (design.titleCard === "none") return null;
  return { title: design.title, authors: authorsOf(project, media, me), position: design.titleCard };
}

export function settingsOf(project: StudioProject, media: MediaIndex, me: string): MontageSettings {
  const { design } = project;
  return {
    label: design.label,
    subtitles: design.subtitles,
    clipAudio: design.clipAudio,
    kenBurns: design.kenBurns,
    title: titleCard(project, media, me),
    music: Boolean(project.musicId && media.has(project.musicId)),
    musicLevel: design.musicLevel,
  };
}

/** Сцены, у которых медиа ещё есть в списке (после обновления списка что-то могло пропасть). */
export function liveScenes(project: StudioProject, media: MediaIndex): StudioScene[] {
  return project.scenes.filter((s) => {
    const item = media.get(s.mediaId);
    return item && (item.kind === "video" || item.kind === "image");
  });
}

/**
 * План до монтажа — по длительностям из списка и замерам в браузере. Неизвестный клип считаем
 * за 5 с; точные значения движок берёт из самих файлов.
 */
export function previewPlan(
  project: StudioProject,
  media: MediaIndex,
  durations: ReadonlyMap<string, number>,
  me: string,
): PlanResult {
  const scenes = liveScenes(project, media).map((scene) => {
    const item = media.get(scene.mediaId) as StudioMediaItem;
    const line = scene.lineId ? media.get(scene.lineId) : undefined;
    const lineDuration = line ? (durations.get(line.id) ?? line.duration ?? 0) : 0;
    return {
      source: {
        kind: item.kind === "image" ? ("image" as const) : ("video" as const),
        duration: durations.get(item.id) ?? item.duration ?? 5,
        width: null,
        height: null,
        hasAudio: false,
        talking: item.kind === "video" && item.talking === true,
      },
      line: line ? { duration: lineDuration } : null,
      subtitle: scene.subtitle,
    };
  });
  return planMontage(scenes, settingsOf(project, media, me));
}

/** Задание для движка: ссылки, расширения, тексты и настройки. */
export function toPipelineJob(project: StudioProject, media: MediaIndex, me: string, encode: EncodeOptions): PipelineJob {
  const settings = settingsOf(project, media, me);
  const music = project.musicId ? media.get(project.musicId) : undefined;
  return {
    scenes: liveScenes(project, media).map((scene) => {
      const item = media.get(scene.mediaId) as StudioMediaItem;
      const line = scene.lineId ? media.get(scene.lineId) : undefined;
      return {
        kind: item.kind === "image" ? "image" : "video",
        talking: item.kind === "video" && item.talking === true,
        media: { source: item.url, ext: item.ext },
        line: line ? { source: line.url, ext: line.ext } : null,
        subtitle: scene.subtitle,
      };
    }),
    music: music ? { source: music.url, ext: music.ext } : null,
    settings: {
      label: settings.label,
      subtitles: settings.subtitles,
      clipAudio: settings.clipAudio,
      kenBurns: settings.kenBurns,
      title: settings.title,
      musicLevel: settings.musicLevel,
    },
    encode,
  };
}

// ---------- черновик ----------

const DRAFT_KEY = "studio-draft:v1";

function isScene(value: unknown): value is StudioScene {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.key === "string" &&
    typeof s.mediaId === "string" &&
    (s.lineId === null || typeof s.lineId === "string") &&
    typeof s.subtitle === "string" &&
    typeof s.subtitleEdited === "boolean"
  );
}

/** Черновик из localStorage (только id и тексты; ссылки всегда свежие с сервера). */
export function loadDraft(): StudioProject | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioProject>;
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes.filter(isScene).slice(0, LIMITS.maxScenes) : [];
    const design = { ...DEFAULT_DESIGN, ...(parsed.design && typeof parsed.design === "object" ? parsed.design : {}) };
    if (!["none", "start", "end"].includes(design.titleCard)) design.titleCard = "end";
    if (!Object.hasOwn(MUSIC_LEVEL_DB, design.musicLevel)) design.musicLevel = "normal";
    return { scenes, musicId: typeof parsed.musicId === "string" ? parsed.musicId : null, design };
  } catch {
    return null;
  }
}

export function saveDraft(project: StudioProject): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(project));
  } catch {
    // приватный режим или нет места — черновик просто не сохранится
  }
}

/** Убрать из черновика то, чего больше нет в списке медиа. */
export function reconcile(project: StudioProject, media: MediaIndex): StudioProject {
  return {
    ...project,
    scenes: liveScenes(project, media).map((s) => ({
      ...s,
      lineId: s.lineId && media.get(s.lineId)?.kind === "voice" ? s.lineId : null,
    })),
    musicId: project.musicId && media.get(project.musicId)?.kind === "music" ? project.musicId : null,
  };
}
