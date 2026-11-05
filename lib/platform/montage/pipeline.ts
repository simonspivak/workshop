import {
  LIMITS,
  OUTPUT,
  buildAss,
  concatList,
  finalArgs,
  finishPlan,
  parseProbeLog,
  planScene,
  probeArgs,
  sceneArgs,
  titleArgs,
  titleSegment,
  type EncodeOptions,
  type MontagePlan,
  type MontageSettings,
  type ProbeResult,
  type Segment,
} from "./args";

/*
  Сценарий монтажа без привязки к ffmpeg.wasm: что скачать, что спросить у ffmpeg и в каком порядке.
  Браузер (engine.ts) подставляет ffmpeg.wasm, тест (test/run.mjs) — нативный ffmpeg и то же
  wasm-ядро в Node. Так тест проверяет ровно тот код, что работает у ученика.

  Память: сцены идут по одной — скачали клип и реплику, смонтировали сегмент, удалили исходники.
  В ФС ffmpeg остаются только готовые сегменты (≈ 1 МБ видео + 0,9 МБ звука на 5 с).
*/

export type MontageBackend = {
  write(name: string, data: Uint8Array | string): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  remove(name: string): Promise<void>;
  /** onTime — секунды готового выхода текущей команды (для прогресса) */
  exec(args: string[], onTime?: (seconds: number) => void): Promise<{ code: number; log: string }>;
};

/** Скачать исходник (в браузере — fetch по подписанной ссылке). */
export type MediaLoader = (source: string, signal: AbortSignal | undefined) => Promise<Uint8Array>;

export type PipelineMedia = { source: string; ext: string };

export type PipelineScene = {
  kind: "video" | "image";
  /** клип «Говорящая голова»: реплика с 0 с (см. SceneSource.talking) */
  talking?: boolean;
  media: PipelineMedia;
  line: PipelineMedia | null;
  subtitle: string;
};

export type PipelineJob = {
  scenes: PipelineScene[];
  music: PipelineMedia | null;
  settings: Omit<MontageSettings, "music">;
  encode: EncodeOptions;
};

export type PipelineStage = "download" | "render" | "title" | "final";

export type PipelineProgress = {
  stage: PipelineStage;
  /** номер сцены с нуля (для download/render) */
  scene: number | null;
  sceneCount: number;
  /** кадры уже готовых сегментов */
  framesDone: number;
  /** кадры текущего сегмента и сколько из них готово */
  segmentFrames: number;
  segmentDone: number;
  /** сколько секунд ушло на кодирование (без скачивания) — для честной оценки скорости */
  encodeSeconds: number;
};

export type MontageErrorCode =
  | "unsupported"
  | "core_failed"
  | "download_failed"
  | "probe_failed"
  | "too_long"
  | "too_many_scenes"
  | "no_scenes"
  | "ffmpeg_failed"
  | "out_of_memory"
  | "cancelled";

export class MontageError extends Error {
  // без parameter properties: этот файл исполняет и Node-тест (type stripping)
  readonly code: MontageErrorCode;
  readonly detail: string | undefined;
  constructor(code: MontageErrorCode, detail?: string) {
    super(code);
    this.name = "MontageError";
    this.code = code;
    this.detail = detail;
  }
}

export type PipelineResult = { data: Uint8Array; plan: MontagePlan; probes: ProbeResult[] };

const safeExt = (ext: string) => (/^[a-z0-9]{2,5}$/.test(ext) ? ext : "bin");

function isOom(log: string): boolean {
  return /Cannot enlarge memory|out of memory|OOM|Cannot allocate memory/i.test(log);
}

export async function runPipeline(
  backend: MontageBackend,
  load: MediaLoader,
  job: PipelineJob,
  hooks: {
    onProgress?: (p: PipelineProgress) => void;
    signal?: AbortSignal;
    now?: () => number;
    /** не удалять промежуточные файлы (для теста) */
    keepFiles?: boolean;
  } = {},
): Promise<PipelineResult> {
  const { signal } = hooks;
  const now = hooks.now ?? (() => Date.now());
  const sceneCount = job.scenes.length;
  if (sceneCount === 0) throw new MontageError("no_scenes");
  if (sceneCount > LIMITS.maxScenes) throw new MontageError("too_many_scenes");

  const created = new Set<string>();
  const progress: PipelineProgress = {
    stage: "download",
    scene: null,
    sceneCount,
    framesDone: 0,
    segmentFrames: 0,
    segmentDone: 0,
    encodeSeconds: 0,
  };
  const emit = (patch: Partial<PipelineProgress>) => {
    Object.assign(progress, patch);
    hooks.onProgress?.({ ...progress });
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new MontageError("cancelled");
  };
  const write = async (name: string, data: Uint8Array | string) => {
    await backend.write(name, data);
    created.add(name);
  };
  const remove = async (name: string) => {
    created.delete(name);
    await backend.remove(name).catch(() => undefined);
  };
  const run = async (args: string[], frames: number) => {
    checkAbort();
    emit({ segmentFrames: frames, segmentDone: 0 });
    const started = now();
    const result = await backend.exec(args, (seconds) =>
      emit({ segmentDone: Math.min(frames, Math.round(seconds * OUTPUT.fps)) }),
    );
    checkAbort();
    if (result.code !== 0) {
      throw new MontageError(isOom(result.log) ? "out_of_memory" : "ffmpeg_failed", result.log.slice(-1200));
    }
    progress.encodeSeconds += (now() - started) / 1000;
    emit({ framesDone: progress.framesDone + frames, segmentFrames: 0, segmentDone: 0 });
  };
  const probe = async (name: string): Promise<ProbeResult> => {
    // ffmpeg -i без выхода завершается с ошибкой — это нормально, нужен только лог
    const result = await backend.exec(probeArgs(name));
    return parseProbeLog(result.log);
  };
  const fetchTo = async (media: PipelineMedia, name: string) => {
    checkAbort();
    let data: Uint8Array;
    try {
      data = await load(media.source, signal);
    } catch (error) {
      if (signal?.aborted) throw new MontageError("cancelled");
      throw new MontageError("download_failed", error instanceof Error ? error.message : String(error));
    }
    await write(name, data);
  };

  try {
    const segments: Segment[] = [];
    const parts: { video: string; audio: string; duration: number }[] = [];
    const probes: ProbeResult[] = [];
    let cursor = 0;

    const renderTitle = async () => {
      if (!job.settings.title) return;
      emit({ stage: "title", scene: null });
      const segment = titleSegment(job.settings.title, cursor);
      const index = segments.length;
      const files = { ass: `seg-${index}.ass`, video: `seg-${index}.mp4`, audio: `seg-${index}.wav` };
      await write(files.ass, buildAss(segment) ?? "");
      created.add(files.video).add(files.audio);
      await run(titleArgs(segment, files, job.encode), segment.frames);
      await remove(files.ass);
      segments.push(segment);
      parts.push({ video: files.video, audio: files.audio, duration: segment.duration });
      cursor += segment.duration;
    };

    if (job.settings.title?.position === "start") await renderTitle();

    for (const [i, scene] of job.scenes.entries()) {
      emit({ stage: "download", scene: i });
      const input = `in-${i}.${safeExt(scene.media.ext)}`;
      await fetchTo(scene.media, input);
      const info = await probe(input);
      if (scene.kind === "video" && !info.hasVideo) throw new MontageError("probe_failed", `scene ${i + 1}: no video`);
      probes.push(info);

      let lineFile: string | null = null;
      let lineDuration = 0;
      if (scene.line) {
        lineFile = `line-${i}.${safeExt(scene.line.ext)}`;
        await fetchTo(scene.line, lineFile);
        const lineInfo = await probe(lineFile);
        if (!lineInfo.hasAudio || !lineInfo.duration) throw new MontageError("probe_failed", `scene ${i + 1}: no audio in line`);
        lineDuration = lineInfo.duration;
      }

      const segment = planScene(
        {
          source: {
            kind: scene.kind,
            duration: info.duration,
            width: info.width,
            height: info.height,
            hasAudio: info.hasAudio,
            talking: scene.talking === true,
          },
          line: lineFile ? { duration: lineDuration } : null,
          subtitle: scene.subtitle,
        },
        job.settings,
        i,
        cursor,
      );
      const titleAfter = job.settings.title?.position === "end" ? titleSegment(job.settings.title, 0).duration : 0;
      if (cursor + segment.duration + titleAfter > LIMITS.maxTotalSeconds + 1e-6) throw new MontageError("too_long");

      const index = segments.length;
      const ass = buildAss(segment);
      const files = {
        input,
        line: lineFile,
        ass: ass ? `seg-${index}.ass` : null,
        video: `seg-${index}.mp4`,
        audio: `seg-${index}.wav`,
      };
      if (ass && files.ass) await write(files.ass, ass);
      created.add(files.video).add(files.audio);
      emit({ stage: "render", scene: i });
      await run(sceneArgs(segment, files, job.encode), segment.frames);

      await remove(input);
      if (lineFile) await remove(lineFile);
      if (files.ass) await remove(files.ass);
      segments.push(segment);
      parts.push({ video: files.video, audio: files.audio, duration: segment.duration });
      cursor += segment.duration;
    }

    if (job.settings.title?.position === "end") await renderTitle();

    const plan = finishPlan(segments, Boolean(job.music));
    emit({ stage: "final", scene: null });
    await write("video.txt", concatList(parts.map((p) => ({ file: p.video, duration: p.duration }))));
    await write("audio.txt", concatList(parts.map((p) => ({ file: p.audio, duration: p.duration }))));
    let musicFile: string | null = null;
    if (job.music) {
      musicFile = `music.${safeExt(job.music.ext)}`;
      await fetchTo(job.music, musicFile);
    }
    const output = "montage.mp4";
    created.add(output);
    // финал быстрый: видео копируется без перекодирования, кодируется только звук
    await run(finalArgs(plan, { videoList: "video.txt", audioList: "audio.txt", music: musicFile, output }, job.settings.musicLevel), 0);
    const data = await backend.read(output);
    return { data, plan, probes };
  } finally {
    if (!hooks.keepFiles) for (const name of [...created]) await remove(name);
  }
}
