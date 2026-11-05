"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { LIMITS, OUTPUT, type SceneSegment } from "@/lib/platform/montage/args";
import { CORE_WASM } from "@/lib/platform/montage/core-files";
import {
  ASSUMED_FPS,
  defaultEncode,
  montageSupported,
  renderMontage,
  terminateMontage,
  type EngineProgress,
} from "@/lib/platform/montage/engine";
import {
  CAPCUT_FALLBACK,
  formatSpan,
  formatMegabytes,
  formatSeconds,
  moderationFieldText,
  montageErrorText,
  studioErrorText,
} from "@/lib/platform/montage/messages";
import { MontageError } from "@/lib/platform/montage/pipeline";
import {
  EMPTY_PROJECT,
  authorsOf,
  defaultAuthors,
  liveScenes,
  loadDraft,
  previewPlan,
  reconcile,
  saveDraft,
  toPipelineJob,
  type MediaIndex,
  type StudioDesign,
  type StudioProject,
} from "@/lib/platform/montage/project";
import type {
  StudioCompleteResponse,
  StudioMediaItem,
  StudioMediaResponse,
  StudioSaveRequest,
  StudioSaveResponse,
} from "@/lib/platform/montage/types";
import { Card, Notice, Skeleton, buttonClass } from "@/components/platform/ui";
import { StudioDesignPanel, StudioMusicPanel, StudioRenderPanel, type RenderState, type SaveState } from "@/components/platform/StudioPanels";
import { StudioPicker, StudioSceneList } from "@/components/platform/StudioScenes";
import { useAudioPreview } from "@/components/platform/StudioThumb";

/*
  Студия автомонтажа (урок 2). Сцены из галереи по порядку, к каждой — реплика и субтитр,
  одна музыка, оформление. «Смонтировать» склеивает в браузере (ffmpeg.wasm, lib/platform/montage),
  результат можно скачать и сохранить в галерею (задача montage, 0★).
*/

type MediaState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudioMediaResponse; index: MediaIndex };

// Поддержка ffmpeg.wasm: на сервере неизвестно (null), в браузере проверяется один раз.
let supportCache: boolean | null = null;
const subscribeNever = () => () => undefined;
const getSupport = () => (supportCache ??= montageSupported());
const getServerSupport = () => null;

const EMPTY_INDEX: MediaIndex = new Map();
const NO_ITEMS: StudioMediaItem[] = [];

function indexOf(items: StudioMediaItem[]): MediaIndex {
  return new Map(items.map((item) => [item.id, item]));
}

async function fetchMedia(): Promise<StudioMediaResponse> {
  const response = await fetch("/api/studio/media", { cache: "no-store", credentials: "same-origin" });
  const body = (await response.json().catch(() => null)) as (StudioMediaResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error ?? "server_error");
  return body;
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; body: T | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as T | null };
}

/** PUT в подписанную ссылку Storage с прогрессом (fetch не умеет прогресс загрузки). */
function uploadBlob(url: string, blob: Blob, apiKey: string | null, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    if (apiKey) xhr.setRequestHeader("apikey", apiKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(blob);
  });
}

function safeFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${base || "montage"}.mp4`;
}

function randomKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function StudioEditor({
  nickname,
  lessonId,
  taskRef,
}: {
  nickname: string;
  lessonId: string | null;
  taskRef: string | null;
}) {
  const supported = useSyncExternalStore(subscribeNever, getSupport, getServerSupport);
  const [media, setMedia] = useState<MediaState>({ status: "loading" });
  const [project, setProject] = useState<StudioProject>(EMPTY_PROJECT);
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [reloading, setReloading] = useState(false);

  const preview = useAudioPreview();
  const draftReady = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const result = useRef<{ blob: Blob; url: string; key: string; project: StudioProject; duration: number } | null>(null);
  const progressAt = useRef(0);
  const progressStage = useRef("");
  const mediaRef = useRef<{ data: StudioMediaResponse; index: MediaIndex } | null>(null);
  /** последний готовый результат — вернуть его на экран, если новый монтаж остановили */
  const lastDone = useRef<RenderState | null>(null);

  const index: MediaIndex = media.status === "ready" ? media.index : EMPTY_INDEX;
  const items = media.status === "ready" ? media.data.items : NO_ITEMS;
  const voices = useMemo(() => items.filter((i) => i.kind === "voice"), [items]);
  const tracks = useMemo(() => items.filter((i) => i.kind === "music"), [items]);
  const visualCount = items.length - voices.length - tracks.length;

  // ---------- данные ----------

  const applyMedia = useCallback((data: StudioMediaResponse) => {
    const next = indexOf(data.items);
    mediaRef.current = { data, index: next };
    // черновик подхватываем один раз, при первой загрузке списка (до неё редактировать нечего)
    const draft = draftReady.current ? null : loadDraft();
    draftReady.current = true;
    setMedia({ status: "ready", data, index: next });
    setProject((current) => reconcile(draft ?? current, next));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchMedia().then(
      (data) => alive && applyMedia(data),
      (error: unknown) => alive && setMedia({ status: "error", message: studioErrorText(error instanceof Error ? error.message : null) }),
    );
    return () => {
      alive = false;
    };
  }, [applyMedia]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      applyMedia(await fetchMedia());
    } catch (error) {
      setMedia({ status: "error", message: studioErrorText(error instanceof Error ? error.message : null) });
    } finally {
      setReloading(false);
    }
  }, [applyMedia]);

  // черновик: только id и тексты
  useEffect(() => {
    if (draftReady.current) saveDraft(project);
  }, [project]);

  // уход со страницы: остановить монтаж, освободить память
  useEffect(() => {
    return () => {
      abort.current?.abort();
      // ядро (32 МБ в памяти) тоже отпускаем: в следующий раз оно придёт из кеша браузера
      terminateMontage({ releaseCore: true });
      if (result.current) URL.revokeObjectURL(result.current.url);
    };
  }, []);

  // длительности выбранных клипов и реплик (метаданные, без скачивания целиком)
  const wanted = useMemo(() => {
    const ids = new Set<string>();
    for (const scene of project.scenes) {
      const item = index.get(scene.mediaId);
      if (item?.kind === "video" && !item.duration) ids.add(item.id);
      if (scene.lineId) ids.add(scene.lineId);
    }
    return [...ids].filter((id) => !measured.has(id));
  }, [project.scenes, index, measured]);

  const probing = useRef(new Map<string, HTMLMediaElement>());

  useEffect(() => {
    const active = probing.current;
    const release = (el: HTMLMediaElement) => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      el.load();
    };
    for (const id of wanted) {
      const item = index.get(id);
      if (!item || active.has(id)) continue;
      const el = document.createElement(item.kind === "video" ? "video" : "audio");
      el.preload = "metadata";
      el.muted = true;
      const done = (seconds: number) => {
        active.delete(id);
        release(el);
        setMeasured((prev) => new Map(prev).set(id, seconds));
      };
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
      el.onerror = () => done(0);
      el.src = item.url;
      active.set(id, el);
    }
  }, [wanted, index]);

  useEffect(() => {
    const active = probing.current;
    return () => {
      for (const el of active.values()) {
        el.onloadedmetadata = null;
        el.onerror = null;
        el.removeAttribute("src");
        el.load();
      }
      active.clear();
    };
  }, []);

  // ---------- план ----------

  const autoAuthors = defaultAuthors(project, index, nickname);
  const authors = authorsOf(project, index, nickname);
  const planned = useMemo(() => previewPlan(project, index, measured, nickname), [project, index, measured, nickname]);
  const scenes = liveScenes(project, index);
  const segments = useMemo(() => {
    const map = new Map<number, SceneSegment>();
    if (planned.ok) for (const s of planned.plan.segments) if (s.type === "scene") map.set(s.sceneIndex, s);
    return map;
  }, [planned]);
  const duration = planned.ok ? planned.plan.duration : planned.duration;
  const frames = Math.round(duration * OUTPUT.fps);

  const issue = !planned.ok
    ? planned.issue === "too_long"
      ? `Ролик выходит ${formatSeconds(duration)} — больше ${LIMITS.maxTotalSeconds} с. Уберите сцену или сократите реплики.`
      : planned.issue === "too_many_scenes"
        ? `Не больше ${LIMITS.maxScenes} сцен.`
        : null
    : null;

  const estimate = useMemo(() => {
    if (frames === 0) return "Добавьте клипы — здесь появится оценка времени.";
    // скорость: ~30 кадров/с на ноутбуке, ~8 на среднем телефоне (замер ядра в Node — 45)
    const desktop = Math.max(5, Math.round(frames / 30));
    const phone = Math.max(15, Math.round(frames / ASSUMED_FPS.phone));
    return (
      `Склейка в браузере: около ${formatSpan(desktop)} на компьютере, до ${formatSpan(phone)} на телефоне. ` +
      `В первый раз ещё загрузится модуль монтажа (${formatMegabytes(CORE_WASM.bytes)}).`
    );
  }, [frames]);

  // ---------- правка проекта ----------

  const locked = render.status === "running" || render.status === "checking";

  const update = useCallback((fn: (p: StudioProject) => StudioProject) => {
    setProject((p) => fn(p));
    setSave((s) => (s.status === "saving" ? s : { status: "idle" }));
  }, []);

  const addScene = useCallback(
    (item: StudioMediaItem) => {
      const key = randomKey();
      update((p) =>
        p.scenes.length >= LIMITS.maxScenes
          ? p
          : { ...p, scenes: [...p.scenes, { key, mediaId: item.id, lineId: null, subtitle: "", subtitleEdited: false }] },
      );
    },
    [update],
  );

  const sceneActions = useMemo(
    () => ({
      move: (key: string, delta: -1 | 1) =>
        update((p) => {
          const i = p.scenes.findIndex((s) => s.key === key);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= p.scenes.length) return p;
          const next = [...p.scenes];
          [next[i], next[j]] = [next[j], next[i]];
          return { ...p, scenes: next };
        }),
      remove: (key: string) => update((p) => ({ ...p, scenes: p.scenes.filter((s) => s.key !== key) })),
      setLine: (key: string, lineId: string | null) =>
        update((p) => ({
          ...p,
          scenes: p.scenes.map((s) => {
            if (s.key !== key) return s;
            const text = lineId ? (mediaRef.current?.index.get(lineId)?.text ?? "") : "";
            // текст реплики становится субтитром, если субтитр не правили руками
            return { ...s, lineId, subtitle: s.subtitleEdited && s.subtitle ? s.subtitle : text, subtitleEdited: s.subtitleEdited && Boolean(s.subtitle) };
          }),
        })),
      setSubtitle: (key: string, text: string) =>
        update((p) => ({ ...p, scenes: p.scenes.map((s) => (s.key === key ? { ...s, subtitle: text, subtitleEdited: true } : s)) })),
    }),
    [update],
  );

  const setDesign = useCallback((patch: Partial<StudioDesign>) => update((p) => ({ ...p, design: { ...p.design, ...patch } })), [update]);

  // ---------- монтаж ----------

  const onProgress = useCallback((progress: EngineProgress) => {
    const now = performance.now();
    const stage =
      progress.phase === "core" ? "core" : `${progress.step.stage}:${progress.step.scene}:${progress.step.framesDone}`;
    // не чаще 5 раз в секунду, кроме смены этапа
    if (stage === progressStage.current && now - progressAt.current < 200) return;
    progressAt.current = now;
    progressStage.current = stage;
    setRender({ status: "running", progress });
  }, []);

  const startRender = useCallback(async () => {
    if (locked) return;
    preview.stop();
    const controller = new AbortController();
    abort.current = controller;
    setRender({ status: "checking" });
    setSave({ status: "idle" });

    try {
      // ссылки живут час: если до конца меньше 5 минут — обновляем список
      let current = mediaRef.current;
      if (!current || Date.parse(current.data.expiresAt) - Date.now() < 5 * 60 * 1000) {
        const data = await fetchMedia().catch(() => {
          throw new MontageError("download_failed");
        });
        applyMedia(data);
        current = mediaRef.current;
      }
      if (!current) throw new MontageError("download_failed");
      const fresh = reconcile(project, current.index);
      const subtitles = liveScenes(fresh, current.index).map((s) => s.subtitle);
      const titleText = fresh.design.title;
      const authorsText = authorsOf(fresh, current.index, nickname);

      // тексты попадут на экран — проверяем модерацией до монтажа, а не после
      const check = await postJson<StudioSaveResponse>("/api/studio/save", {
        idempotencyKey: randomKey(),
        dryRun: true,
        title: titleText,
        authors: authorsText,
        subtitles: fresh.design.subtitles ? subtitles : [],
      } satisfies StudioSaveRequest).catch(() => null);
      if (check?.body && !check.body.ok) {
        const where = moderationFieldText(check.body.field);
        setRender({
          status: "error",
          message: `${studioErrorText(check.body.error)}${where ? ` (${where})` : ""}`,
          fallback: false,
        });
        return;
      }
      if (controller.signal.aborted) throw new MontageError("cancelled");

      const plan = previewPlan(fresh, current.index, measured, nickname);
      setRender({ status: "running", progress: null });
      const output = await renderMontage(toPipelineJob(fresh, current.index, nickname, defaultEncode()), {
        plannedFrames: plan.ok ? plan.plan.frames : Math.round(plan.duration * OUTPUT.fps),
        signal: controller.signal,
        onProgress,
      });
      if (result.current) URL.revokeObjectURL(result.current.url);
      const url = URL.createObjectURL(output.blob);
      result.current = { blob: output.blob, url, key: randomKey(), project: fresh, duration: output.duration };
      const done: RenderState = {
        status: "done",
        url,
        bytes: output.blob.size,
        duration: output.duration,
        seconds: output.elapsedMs / 1000,
      };
      lastDone.current = done;
      setRender(done);
    } catch (error) {
      const code = error instanceof MontageError ? error.code : "ffmpeg_failed";
      if (error instanceof MontageError && error.detail) console.warn("montage failed:", error.code, error.detail.slice(-600));
      if (code === "cancelled") {
        setRender(lastDone.current ?? { status: "idle" });
        return;
      }
      setRender({
        status: "error",
        message: montageErrorText(code),
        fallback: code === "unsupported" || code === "core_failed" || code === "out_of_memory",
      });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [locked, preview, applyMedia, project, nickname, measured, onProgress]);

  const cancelRender = useCallback(() => {
    abort.current?.abort();
  }, []);

  // ---------- сохранение ----------

  const saveToGallery = useCallback(async () => {
    const done = result.current;
    const current = mediaRef.current;
    if (!done || !current || save.status === "saving") return;
    setSave({ status: "saving", uploaded: null });
    const scenesForSave = liveScenes(done.project, current.index).map((s) => ({
      jobId: current.index.get(s.mediaId)?.jobId ?? s.mediaId,
      lineJobId: s.lineId ? (current.index.get(s.lineId)?.jobId ?? null) : null,
    }));
    try {
      const created = await postJson<StudioSaveResponse>("/api/studio/save", {
        idempotencyKey: done.key,
        title: done.project.design.title,
        authors: authorsOf(done.project, current.index, nickname),
        subtitles: done.project.design.subtitles ? liveScenes(done.project, current.index).map((s) => s.subtitle) : [],
        scenes: scenesForSave,
        musicJobId: done.project.musicId ? (current.index.get(done.project.musicId)?.jobId ?? null) : null,
        durationSec: Math.round(done.duration * 100) / 100,
        sizeBytes: done.blob.size,
        lessonId,
        taskRef,
      } satisfies StudioSaveRequest);
      const body = created.body;
      if (!body || !body.ok || body.dryRun) {
        const field = body && !body.ok ? moderationFieldText(body.field) : "";
        setSave({ status: "error", message: `${studioErrorText(body && !body.ok ? body.error : null)}${field ? ` (${field})` : ""}` });
        return;
      }
      if (!body.done) {
        if (!body.uploadUrl) throw new Error("upload_failed");
        if (done.blob.size > body.maxBytes) {
          setSave({ status: "error", message: studioErrorText("too_large") });
          return;
        }
        try {
          await uploadBlob(body.uploadUrl, done.blob, body.apiKey, (ratio) => setSave({ status: "saving", uploaded: ratio }));
        } catch {
          setSave({ status: "error", message: studioErrorText("upload_failed") });
          return;
        }
        const finished = await postJson<StudioCompleteResponse>(`/api/studio/save/${body.jobId}/complete`, {});
        if (!finished.body || !finished.body.ok) {
          setSave({ status: "error", message: studioErrorText(finished.body && !finished.body.ok ? finished.body.error : null) });
          return;
        }
      }
      setSave({ status: "saved" });
    } catch {
      setSave({ status: "error", message: studioErrorText("server_error") });
    }
  }, [save.status, nickname, lessonId, taskRef]);

  // ---------- вёрстка ----------

  if (supported === false) {
    return (
      <Notice tone="warn">
        {montageErrorText("unsupported")} {CAPCUT_FALLBACK}
      </Notice>
    );
  }

  if (media.status === "loading") return <StudioSkeleton />;

  if (media.status === "error") {
    return (
      <Notice tone="error">
        {media.message}{" "}
        <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void reload()}>
          Попробовать ещё раз
        </button>
      </Notice>
    );
  }

  const downloadName = safeFileName(project.design.title);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="grid gap-6">
        <Card
          title="Сцены"
          description="Первая — крючок, последняя — клиффхэнгер. К каждой сцене — своя реплика."
        >
          {scenes.length > 0 && (
            <StudioSceneList
              scenes={scenes}
              media={index}
              voices={voices}
              segments={segments}
              subtitlesOn={project.design.subtitles}
              disabled={locked}
              preview={preview}
              actions={sceneActions}
            />
          )}
          {scenes.length === 0 && visualCount === 0 && (
            <Notice className="mb-4">
              В галерее пока нет готовых клипов и картинок. Сгенерируйте их в{" "}
              <Link href="/app/lessons/2" className="font-semibold text-violet underline underline-offset-4">
                уроке 2
              </Link>{" "}
              и обновите список.
            </Notice>
          )}
          <div className={`flex flex-wrap gap-2 ${scenes.length ? "mt-4" : ""}`}>
            {!pickerOpen && (
              <button
                type="button"
                className={buttonClass("primary")}
                onClick={() => setPickerOpen(true)}
                disabled={locked || scenes.length >= LIMITS.maxScenes || visualCount === 0}
              >
                <Plus aria-hidden="true" className="size-5" /> Добавить сцену
              </button>
            )}
            <button type="button" className={buttonClass("secondary")} onClick={() => void reload()} disabled={reloading || locked}>
              <RefreshCw aria-hidden="true" className={`size-4 ${reloading ? "animate-spin" : ""}`} /> Обновить список
            </button>
          </div>
          {pickerOpen && (
            <div className="mt-4">
              <StudioPicker
                items={items}
                shareGallery={media.data.shareGallery}
                sceneCount={scenes.length}
                onAdd={addScene}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          )}
        </Card>

        <StudioMusicPanel
          tracks={tracks}
          musicId={project.musicId}
          level={project.design.musicLevel}
          disabled={locked}
          preview={preview}
          onChange={(musicId) => update((p) => ({ ...p, musicId }))}
          onLevel={(musicLevel) => setDesign({ musicLevel })}
        />
      </div>

      <div className="grid gap-6">
        <StudioDesignPanel design={project.design} authors={authors} autoAuthors={autoAuthors} disabled={locked} onChange={setDesign} />
        <StudioRenderPanel
          duration={duration}
          sceneCount={scenes.length}
          issue={issue}
          estimate={estimate}
          render={render}
          save={save}
          canSave={render.status === "done"}
          downloadName={downloadName}
          onRender={() => void startRender()}
          onCancel={cancelRender}
          onSave={() => void saveToGallery()}
        />
        {render.status === "error" && render.fallback && <Notice tone="warn">{CAPCUT_FALLBACK}</Notice>}
      </div>
    </div>
  );
}

export function StudioSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="grid gap-6">
        <Skeleton className="h-72" />
        <Skeleton className="h-40" />
      </div>
      <div className="grid gap-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
