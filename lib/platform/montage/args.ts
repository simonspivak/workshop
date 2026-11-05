/*
  Автомонтаж (урок 2): чистые функции — план монтажа, ASS-субтитры и аргументы ffmpeg.

  Файл без импортов и без DOM: тот же код исполняется в браузере (ffmpeg.wasm, ядро 5.1)
  и в Node-тесте (lib/platform/montage/test/run.mjs гоняет эти аргументы через нативный
  ffmpeg и через то же wasm-ядро). Меняете фильтры — запустите `npm run test:montage`.

  Конвейер (по одной сцене, чтобы не держать всё в памяти):
    1. Каждая сцена → seg-N.mp4 (только видео, h264) + seg-N.wav (PCM 44,1 кГц стерео):
       кадр 480×854, 24 fps, реплика с 0,3 с, субтитр и метка «Сделано с ИИ» прожигаются здесь же.
       Если реплика длиннее клипа, последний кадр стоит (tpad clone).
       Длительность сцены кратна двум кадрам (1/12 с): тогда и кадры, и сэмплы целые,
       и склейка не уплывает по синхрону.
    2. Титр (по желанию) — такой же сегмент из цветного фона.
    3. Финал: concat видео без перекодирования, concat звука, музыка −10 dB с приглушением
       ещё на −6 dB под репликами (−16 dB под голосом: музыку слышно, голос сверху;
       автоматизация громкости по известным окнам реплик), кодирование звука в AAC один раз.
*/

export const OUTPUT = { width: 480, height: 854, fps: 24, sampleRate: 44100 } as const;

export const LIMITS = {
  maxScenes: 12,
  maxTotalSeconds: 60,
  maxSubtitleChars: 160,
  maxTitleChars: 60,
  maxAuthorsChars: 80,
} as const;

export const TIMING = {
  /** реплика начинается через 0,3 с после начала клипа */
  lineOffset: 0.3,
  /** запас после реплики, чтобы голос не обрывался склейкой */
  lineTail: 0.3,
  /** картинка вместо клипа */
  imageSeconds: 5,
  titleSeconds: 1.5,
  minSceneSeconds: 1,
  /** клип без реплики, но с субтитром: субтитр до конца сцены минус это */
  subtitleTail: 0.15,
  musicFadeOut: 1.5,
  /** музыка начинает приглушаться за 0,15 с до реплики и возвращается за 0,35 с после */
  duckAttack: 0.15,
  duckRelease: 0.35,
} as const;

export const MIX = {
  /** фон музыки относительно исходной дорожки */
  musicDb: -10,
  /** ещё тише под репликой: итого −16 dB, голос заметно громче музыки, но музыку слышно */
  duckDb: -6,
  /** собственный звук клипа (если оставлен) под репликой */
  clipAudioDb: -6,
} as const;

/** Выбор в студии «Громкость музыки»: сдвиг музыки целиком (и фон, и под репликой), dB. */
export type MusicLevel = "quiet" | "normal" | "loud";
export const MUSIC_LEVEL_DB: Record<MusicLevel, number> = { quiet: -4, normal: 0, loud: 4 };

/**
 * Каталог шрифтов в ФС ffmpeg (относительно рабочего каталога, как и все пути здесь:
 * так одни и те же аргументы работают в wasm и в нативном ffmpeg теста) и имя семейства в ASS.
 * Файл шрифта — public/fonts/Onest-Bold.ttf (OFL).
 */
export const FONTS_DIR = "fonts";
export const FONT_FILE = "Onest-Bold.ttf";
export const FONT_FAMILY = "Onest";

export type Fit = "cover" | "contain";
export type X264Preset = "ultrafast" | "superfast" | "veryfast";
export type EncodeOptions = { preset: X264Preset; crf: number };
export const DEFAULT_ENCODE: EncodeOptions = { preset: "veryfast", crf: 23 };

// ---------- время ----------

const STEP_PER_SECOND = OUTPUT.fps / 2; // шаг 2 кадра = 1/12 с = 3675 сэмплов

/** Вверх до кратного двум кадрам. */
export function alignUp(seconds: number): number {
  return Math.ceil(seconds * STEP_PER_SECOND - 1e-6) / STEP_PER_SECOND;
}

/** Вниз до кратного двум кадрам. */
export function alignDown(seconds: number): number {
  return Math.floor(seconds * STEP_PER_SECOND + 1e-6) / STEP_PER_SECOND;
}

export function frameCount(seconds: number): number {
  return Math.round(seconds * OUTPUT.fps);
}

export function sampleCount(seconds: number): number {
  return Math.round(seconds * OUTPUT.sampleRate);
}

/** Секунды для аргументов ffmpeg: без экспоненты и хвостов плавающей точки. */
export function sec(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") || "0";
}

/** Время ASS: H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// ---------- текст ----------

// Символы, которые есть в шрифте Onest (public/fonts): латиница, кириллица, румынские ș ț,
// тире, кавычки, многоточие, №, €, ₽. Остальное (эмодзи и т. п.) выкидываем — иначе квадратики.
const SUPPORTED = /[ -~ -ſȘ-țЀ-џ–—‘-„•…№€₽]/u;

/** Текст для экрана: одна строка, без управляющих символов и эмодзи, не длиннее max. */
export function cleanText(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const kept = [...text.normalize("NFC").replace(/[\r\n\t]+/g, " ")]
    .filter((ch) => SUPPORTED.test(ch))
    .join("");
  const collapsed = kept.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Экранирование для текста события ASS: фигурные скобки — это теги, обратный слеш — команды. */
export function assEscape(text: string): string {
  return text.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")");
}

// ---------- probe ----------

export type ProbeResult = {
  duration: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
};

/** `ffmpeg -hide_banner -i file` без выхода: ffmpeg печатает описание файла и завершается с ошибкой. */
export function probeArgs(file: string): string[] {
  return ["-hide_banner", "-i", file];
}

/** Разбор вывода `ffmpeg -i` (работает и для нативного ffmpeg 6, и для ядра 5.1 в wasm). */
export function parseProbeLog(log: string | readonly string[]): ProbeResult {
  const text = typeof log === "string" ? log : log.join("\n");
  const result: ProbeResult = { duration: null, hasVideo: false, hasAudio: false, width: null, height: null };
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (duration) {
    const value = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    if (Number.isFinite(value) && value > 0) result.duration = value;
  }
  for (const line of text.split("\n")) {
    if (!/Stream #\d+:\d+/.test(line)) continue;
    if (/:\s*Audio:/.test(line)) result.hasAudio = true;
    if (/:\s*Video:/.test(line) && !result.hasVideo) {
      // обложка mp3 (attached pic) — не видео
      if (/attached pic/.test(line)) continue;
      result.hasVideo = true;
      const size = /[\s,](\d{2,5})x(\d{2,5})(?=[\s,[])/.exec(line);
      if (size) {
        result.width = Number(size[1]);
        result.height = Number(size[2]);
      }
    }
  }
  return result;
}

// ---------- план ----------

export type SceneSource = {
  kind: "video" | "image";
  /** длительность клипа по probe, с; для картинки не используется */
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
};

export type SceneInput = {
  source: SceneSource;
  /** озвучка реплики (длительность по probe) или null — сцена без голоса */
  line: { duration: number } | null;
  /** текст субтитра (обычно текст реплики); пусто — без субтитра */
  subtitle: string | null;
};

export type TitleCard = { title: string; authors: string; position: "start" | "end" };

export type MontageSettings = {
  /** метка «Сделано с ИИ» в углу */
  label: boolean;
  subtitles: boolean;
  /** оставить собственный звук клипов (по умолчанию нет: клипы снимаются без слов) */
  clipAudio: boolean;
  /** медленный наезд на картинки */
  kenBurns: boolean;
  title: TitleCard | null;
  music: boolean;
  /** нет — «обычно» */
  musicLevel?: MusicLevel;
};

export type Window = { start: number; end: number };

export type SceneSegment = {
  type: "scene";
  sceneIndex: number;
  kind: "video" | "image";
  /** начало в итоговом ролике, с */
  start: number;
  duration: number;
  frames: number;
  samples: number;
  fit: Fit;
  /** сколько секунд стоп-кадра добавить в конце (реплика длиннее клипа) */
  freeze: number;
  kenBurns: boolean;
  clipAudio: boolean;
  /** окно реплики внутри сцены */
  line: Window | null;
  subtitle: (Window & { text: string }) | null;
  label: boolean;
};

export type TitleSegment = {
  type: "title";
  start: number;
  duration: number;
  frames: number;
  samples: number;
  title: string;
  authors: string;
};

export type Segment = SceneSegment | TitleSegment;

export type MontagePlan = {
  segments: Segment[];
  duration: number;
  frames: number;
  /** окна реплик в итоговом ролике — под ними музыка тише */
  duckWindows: Window[];
  music: boolean;
};

export type PlanIssue = "no_scenes" | "too_many_scenes" | "too_long";

export type PlanResult = { ok: true; plan: MontagePlan } | { ok: false; issue: PlanIssue; duration: number };

/**
 * Как вписать кадр в 9:16: вертикальные (от 9:20 до 4:5) — обрезать по краям (cover),
 * остальные — целиком с чёрными полями (contain), чтобы не резать героя.
 */
export function chooseFit(width: number | null, height: number | null): Fit {
  if (!width || !height) return "contain";
  const aspect = width / height;
  return aspect >= 0.45 && aspect <= 0.8 ? "cover" : "contain";
}

/** Длительность сцены и окна реплики/субтитра. Длительность кратна двум кадрам. */
export function planScene(
  scene: SceneInput,
  settings: Pick<MontageSettings, "label" | "subtitles" | "clipAudio" | "kenBurns">,
  sceneIndex: number,
  start: number,
): SceneSegment {
  const { source } = scene;
  const base =
    source.kind === "image"
      ? TIMING.imageSeconds
      : Math.max(TIMING.minSceneSeconds, alignDown(source.duration && source.duration > 0 ? source.duration : TIMING.imageSeconds));
  const lineDuration = scene.line && scene.line.duration > 0 ? scene.line.duration : 0;
  const needed = lineDuration > 0 ? TIMING.lineOffset + lineDuration + TIMING.lineTail : 0;
  const duration = Math.max(alignUp(base), alignUp(needed));
  const line = lineDuration > 0 ? { start: TIMING.lineOffset, end: TIMING.lineOffset + lineDuration } : null;

  const text = settings.subtitles ? cleanText(scene.subtitle, LIMITS.maxSubtitleChars) : "";
  let subtitle: SceneSegment["subtitle"] = null;
  if (text) {
    const subStart = TIMING.lineOffset;
    const subEnd = line ? Math.min(duration - 0.05, line.end + 0.25) : duration - TIMING.subtitleTail;
    if (subEnd > subStart) subtitle = { start: subStart, end: subEnd, text };
  }

  const fit = chooseFit(source.width, source.height);
  return {
    type: "scene",
    sceneIndex,
    kind: source.kind,
    start,
    duration,
    frames: frameCount(duration),
    samples: sampleCount(duration),
    fit,
    freeze: source.kind === "video" ? Math.max(0, duration - base) : 0,
    kenBurns: source.kind === "image" && settings.kenBurns && fit === "cover",
    clipAudio: source.kind === "video" && settings.clipAudio && source.hasAudio,
    line,
    subtitle,
    label: settings.label,
  };
}

/**
 * План всего ролика: порядок сегментов, их начало, окна реплик. Проверяет лимиты.
 * Движок в браузере строит тот же план по сценам (planScene/titleSegment/finishPlan),
 * чтобы скачивать и монтировать клипы по одному.
 */
export function planMontage(scenes: readonly SceneInput[], settings: MontageSettings): PlanResult {
  if (scenes.length === 0) return { ok: false, issue: "no_scenes", duration: 0 };

  const segments: Segment[] = [];
  let cursor = 0;
  if (settings.title?.position === "start") {
    segments.push(titleSegment(settings.title, cursor));
    cursor += segments[0].duration;
  }
  scenes.forEach((scene, index) => {
    const segment = planScene(scene, settings, index, cursor);
    segments.push(segment);
    cursor += segment.duration;
  });
  if (settings.title?.position === "end") segments.push(titleSegment(settings.title, cursor));

  const plan = finishPlan(segments, settings.music);
  if (scenes.length > LIMITS.maxScenes) return { ok: false, issue: "too_many_scenes", duration: plan.duration };
  if (plan.duration > LIMITS.maxTotalSeconds + 1e-6) return { ok: false, issue: "too_long", duration: plan.duration };
  return { ok: true, plan };
}

/** Титр, начинающийся в start. */
export function titleSegment(card: TitleCard, start: number): TitleSegment {
  const duration = alignUp(TIMING.titleSeconds);
  return {
    type: "title",
    start,
    duration,
    frames: frameCount(duration),
    samples: sampleCount(duration),
    title: cleanText(card.title, LIMITS.maxTitleChars),
    authors: cleanText(card.authors, LIMITS.maxAuthorsChars),
  };
}

/** Итог по готовым сегментам: длительность, кадры, окна реплик для приглушения музыки. */
export function finishPlan(segments: Segment[], music: boolean): MontagePlan {
  const duration = segments.reduce((sum, s) => sum + s.duration, 0);
  const duckWindows = segments.flatMap((s) =>
    s.type === "scene" && s.line ? [{ start: s.start + s.line.start, end: s.start + s.line.end }] : [],
  );
  return { segments, duration, frames: frameCount(duration), duckWindows, music };
}

// ---------- ASS ----------

const WHITE = "&H00FFFFFF";
const BLACK = "&H00000000";
const SUN = "&H003BD4FF"; // #FFD43B в BGR
const MUTED = "&H00D6C9C3"; // #C3C9D6

/** Цвет фона титра (токен ink сайта). */
export const TITLE_BACKGROUND = "0x0b0b1a";

const STYLE_FORMAT =
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, " +
  "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

function style(
  name: string,
  size: number,
  colors: { primary: string; outline: string; back: string },
  border: { style: 1 | 3; outline: number; shadow: number },
  alignment: number,
  margins: { l: number; r: number; v: number },
): string {
  return (
    `Style: ${name},${FONT_FAMILY},${size},${colors.primary},${colors.primary},${colors.outline},${colors.back},` +
    `-1,0,0,0,100,100,0,0,${border.style},${border.outline},${border.shadow},${alignment},${margins.l},${margins.r},${margins.v},1`
  );
}

function dialogue(layer: number, start: number, end: number, styleName: string, text: string): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${text}`;
}

/**
 * ASS для одного сегмента. Субтитр — внизу над интерфейсом Reels/TikTok (MarginV 170 из 854),
 * метка — в правом верхнем углу на полупрозрачной плашке. null — рисовать нечего.
 */
export function buildAss(segment: Segment): string | null {
  const events: string[] = [];
  if (segment.type === "scene") {
    if (segment.subtitle) {
      events.push(dialogue(0, segment.subtitle.start, segment.subtitle.end, "Sub", assEscape(segment.subtitle.text)));
    }
    if (segment.label) events.push(dialogue(1, 0, segment.duration, "Label", "Сделано с ИИ"));
  } else {
    const parts = [
      segment.title ? `{\\fs40}${assEscape(segment.title)}` : "",
      `{\\fs22\\c${SUN}&}Сделано с ИИ`,
      segment.authors ? `{\\fs20\\c${MUTED}&}${assEscape(segment.authors)}` : "",
    ].filter(Boolean);
    events.push(dialogue(0, 0, segment.duration, "Title", parts.join("\\N{\\fs12}\\N")));
  }
  if (events.length === 0) return null;

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUTPUT.width}`,
    `PlayResY: ${OUTPUT.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    STYLE_FORMAT,
    style("Sub", 32, { primary: WHITE, outline: BLACK, back: "&H80000000" }, { style: 1, outline: 2.5, shadow: 1 }, 2, {
      l: 32,
      r: 32,
      v: 170,
    }),
    style("Label", 15, { primary: WHITE, outline: "&H59000000", back: "&H59000000" }, { style: 3, outline: 5, shadow: 0 }, 9, {
      l: 18,
      r: 18,
      v: 22,
    }),
    style("Title", 40, { primary: WHITE, outline: BLACK, back: BLACK }, { style: 1, outline: 0, shadow: 0 }, 5, {
      l: 36,
      r: 36,
      v: 0,
    }),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

// ---------- аргументы ffmpeg ----------

const AUDIO_FORMAT = `aresample=${OUTPUT.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo`;

function videoEncodeArgs(encode: EncodeOptions): string[] {
  return [
    "-c:v", "libx264",
    "-preset", encode.preset,
    "-crf", String(encode.crf),
    "-profile:v", "main",
    "-level:v", "3.1",
    "-pix_fmt", "yuv420p",
    "-g", String(OUTPUT.fps * 2),
  ];
}

function wavArgs(): string[] {
  return ["-c:a", "pcm_s16le", "-ar", String(OUTPUT.sampleRate), "-ac", "2", "-f", "wav"];
}

/** Вписать кадр в 480×854. */
function fitFilters(fit: Fit, width: number, height: number): string[] {
  return fit === "cover"
    ? [`scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic`, `crop=${width}:${height}`]
    : [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=bicubic`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      ];
}

function assFilter(file: string): string {
  return `ass=filename=${file}:fontsdir=${FONTS_DIR}`;
}

export type SceneFiles = {
  /** клип или картинка */
  input: string;
  /** озвучка реплики */
  line: string | null;
  /** ASS (если buildAss вернул текст) */
  ass: string | null;
  video: string;
  audio: string;
};

/** Видео-часть графа сцены: [0:v] → [v]. */
export function sceneVideoGraph(segment: SceneSegment, assFile: string | null): string {
  const { width, height, fps } = OUTPUT;
  const n = segment.frames;
  const chain: string[] = [];
  if (segment.kind === "video") {
    // tpad всегда с запасом 0,5 с: даже если probe переоценил длину, кадров хватит; trim режет ровно n
    chain.push(
      "setpts=PTS-STARTPTS",
      `fps=${fps}`,
      ...fitFilters(segment.fit, width, height),
      "setsar=1",
      "format=yuv420p",
      `tpad=stop_mode=clone:stop_duration=${sec(segment.freeze + 0.5)}`,
      `trim=end_frame=${n}`,
      "setpts=PTS-STARTPTS",
    );
  } else if (segment.kenBurns) {
    // одна картинка → n кадров с наездом 1.00 → 1.08; масштаб ×2, чтобы не дрожало
    chain.push(
      ...fitFilters("cover", width * 2, height * 2),
      "setsar=1",
      `zoompan=z='1+0.08*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${width}x${height}:fps=${fps}`,
      "format=yuv420p",
      `trim=end_frame=${n}`,
      `setpts=N/${fps}/TB`,
    );
  } else {
    // одна картинка: вписываем один раз, потом повторяем кадр
    chain.push(
      ...fitFilters(segment.fit, width, height),
      "setsar=1",
      "format=yuv420p",
      `loop=loop=${n - 1}:size=1:start=0`,
      `trim=end_frame=${n}`,
      `setpts=N/${fps}/TB`,
    );
  }
  if (assFile) chain.push(assFilter(assFile));
  return `[0:v]${chain.join(",")}[v]`;
}

/** Звуковая часть графа сцены → [a]. Вход реплики — [1:a]. */
export function sceneAudioGraph(segment: SceneSegment, hasLineInput: boolean): string {
  const end = `atrim=end_sample=${segment.samples}`;
  const parts: string[] = [];
  const base = segment.clipAudio
    ? `[0:a]asetpts=PTS-STARTPTS,${AUDIO_FORMAT},volume=${MIX.clipAudioDb}dB,apad,${end}`
    : null;
  const delayMs = Math.round(TIMING.lineOffset * 1000);
  const line =
    hasLineInput && segment.line
      ? `[1:a]asetpts=PTS-STARTPTS,${AUDIO_FORMAT},adelay=${delayMs}|${delayMs},apad,${end}`
      : null;

  if (base && line) {
    parts.push(`${base}[base]`, `${line}[line]`, "[base][line]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]");
  } else if (base) {
    parts.push(`${base}[a]`);
  } else if (line) {
    parts.push(`${line}[a]`);
  } else {
    parts.push(`anullsrc=r=${OUTPUT.sampleRate}:cl=stereo,${end}[a]`);
  }
  return parts.join(";");
}

/** Аргументы для одной сцены: на выходе files.video (h264, без звука) и files.audio (wav). */
export function sceneArgs(segment: SceneSegment, files: SceneFiles, encode: EncodeOptions = DEFAULT_ENCODE): string[] {
  const hasLine = Boolean(files.line && segment.line);
  const graph = [sceneVideoGraph(segment, files.ass), sceneAudioGraph(segment, hasLine)].join(";");
  return [
    "-hide_banner",
    "-nostats",
    // картинка читается как поток 25 fps; задаём 24, иначе метки времени кадров не целые
    ...(segment.kind === "image" ? ["-framerate", String(OUTPUT.fps)] : []),
    "-i", files.input,
    ...(hasLine ? ["-i", files.line as string] : []),
    "-filter_complex", graph,
    "-map", "[v]", ...videoEncodeArgs(encode), "-an", "-f", "mp4", files.video,
    "-map", "[a]", "-vn", ...wavArgs(), files.audio,
  ];
}

/** Аргументы титра: тёмный фон, название, «Сделано с ИИ», ники. */
export function titleArgs(
  segment: TitleSegment,
  files: { ass: string; video: string; audio: string },
  encode: EncodeOptions = DEFAULT_ENCODE,
): string[] {
  const { width, height, fps, sampleRate } = OUTPUT;
  const video =
    `color=c=${TITLE_BACKGROUND}:s=${width}x${height}:r=${fps}:d=${sec(segment.duration + 0.5)},` +
    `format=yuv420p,trim=end_frame=${segment.frames},setpts=N/${fps}/TB,${assFilter(files.ass)}[v]`;
  const audio = `anullsrc=r=${sampleRate}:cl=stereo,atrim=end_sample=${segment.samples}[a]`;
  return [
    "-hide_banner",
    "-nostats",
    "-filter_complex", `${video};${audio}`,
    "-map", "[v]", ...videoEncodeArgs(encode), "-an", "-f", "mp4", files.video,
    "-map", "[a]", "-vn", ...wavArgs(), files.audio,
  ];
}

/** Список для concat demuxer. duration задаёт точный сдвиг следующего файла. */
export function concatList(entries: readonly { file: string; duration: number }[]): string {
  return ["ffconcat version 1.0", ...entries.flatMap((e) => [`file '${e.file.replace(/'/g, "")}'`, `duration ${sec(e.duration)}`]), ""].join(
    "\n",
  );
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function num(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

/**
 * Громкость музыки во времени (выражение ffmpeg, t — секунды):
 * −10 dB всегда, ещё −6 dB внутри окон реплик, с плавным входом и выходом.
 * levelDb — сдвиг из «Громкость музыки» (MUSIC_LEVEL_DB), на всю музыку.
 */
export function duckExpression(windows: readonly Window[], levelDb = 0): string {
  const base = dbToGain(MIX.musicDb + levelDb);
  if (windows.length === 0) return num(base);
  const depth = 1 - dbToGain(MIX.duckDb);
  const a = TIMING.duckAttack;
  const r = TIMING.duckRelease;
  const terms = windows.map(
    (w) => `clip((t-${num(w.start - a)})/${num(a)},0,1)*clip((${num(w.end + r)}-t)/${num(r)},0,1)`,
  );
  return `${num(base)}*(1-${num(depth)}*min(1,${terms.join("+")}))`;
}

/**
 * Финальная сборка: видео склеивается без перекодирования, звук сцен + музыка → AAC.
 * Музыка зацикливается, если короче ролика, и затухает в конце.
 */
export function finalArgs(
  plan: Pick<MontagePlan, "duration" | "duckWindows">,
  files: { videoList: string; audioList: string; music: string | null; output: string },
  musicLevel: MusicLevel = "normal",
): string[] {
  const total = plan.duration;
  const inputs = ["-f", "concat", "-safe", "0", "-i", files.videoList, "-f", "concat", "-safe", "0", "-i", files.audioList];
  const encodeAudio = ["-c:a", "aac", "-b:a", "128k", "-ar", String(OUTPUT.sampleRate), "-ac", "2"];
  const tail = ["-t", sec(total), "-movflags", "+faststart", "-f", "mp4", files.output];

  if (!files.music) {
    return ["-hide_banner", "-nostats", ...inputs, "-map", "0:v", "-map", "1:a", "-c:v", "copy", ...encodeAudio, ...tail];
  }

  const fadeStart = Math.max(0, total - TIMING.musicFadeOut);
  const music = [
    "[2:a]asetpts=PTS-STARTPTS",
    AUDIO_FORMAT,
    `atrim=end_sample=${sampleCount(total)}`,
    // кадры по 10 мс: громкость меняется плавно, без «ступенек»
    `asetnsamples=n=${OUTPUT.sampleRate / 100}:p=0`,
    `volume='${duckExpression(plan.duckWindows, MUSIC_LEVEL_DB[musicLevel] ?? 0)}':eval=frame`,
    "afade=t=in:d=0.05",
    `afade=t=out:st=${sec(fadeStart)}:d=${sec(Math.min(TIMING.musicFadeOut, total))}`,
  ].join(",");
  const graph = `${music}[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=disabled[a]`;
  return [
    "-hide_banner",
    "-nostats",
    ...inputs,
    "-stream_loop", "-1", "-i", files.music,
    "-filter_complex", graph,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy",
    ...encodeAudio,
    ...tail,
  ];
}
