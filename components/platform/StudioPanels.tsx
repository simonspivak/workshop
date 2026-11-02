"use client";

import { useId } from "react";
import Link from "next/link";
import { Download, LoaderCircle, Save, Square, Wand2 } from "lucide-react";
import { LIMITS } from "@/lib/platform/montage/args";
import type { EngineProgress } from "@/lib/platform/montage/engine";
import { formatEta, formatMegabytes, formatSeconds } from "@/lib/platform/montage/messages";
import type { StudioDesign } from "@/lib/platform/montage/project";
import type { StudioMediaItem } from "@/lib/platform/montage/types";
import { Badge, Card, Notice, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { PlayButton } from "@/components/platform/StudioThumb";

// ---------- музыка ----------

export function StudioMusicPanel({
  tracks,
  musicId,
  disabled,
  preview,
  onChange,
}: {
  tracks: StudioMediaItem[];
  musicId: string | null;
  disabled: boolean;
  preview: { playing: string | null; toggle: (id: string, url: string) => void };
  onChange: (id: string | null) => void;
}) {
  const name = useId();
  return (
    <Card title="Музыка" description="Одна тема на серию. Под репликами она сама станет тише.">
      <fieldset disabled={disabled}>
        <legend className="sr-only">Трек для серии</legend>
        <ul className="divide-y divide-ink/10">
          <li>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
              <input type="radio" name={name} className="size-5 accent-violet" checked={musicId === null} onChange={() => onChange(null)} />
              <span>Без музыки</span>
            </label>
          </li>
          {tracks.map((track) => (
            <li key={track.id} className="flex items-center gap-2">
              <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                <input
                  type="radio"
                  name={name}
                  className="size-5 shrink-0 accent-violet"
                  checked={musicId === track.id}
                  onChange={() => onChange(track.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate">{track.title}</span>
                  <span className="block font-mono text-xs text-ink-soft">
                    {track.duration ? formatSeconds(track.duration) : "трек"}
                    {track.own ? "" : ` · ${track.author ?? "группа"}`}
                  </span>
                </span>
              </label>
              <PlayButton playing={preview.playing === track.id} onClick={() => preview.toggle(track.id, track.url)} label={track.title} />
            </li>
          ))}
        </ul>
      </fieldset>
      {tracks.length === 0 && <p className={hintClass}>Треков пока нет — тема из Suno появится здесь, когда будет готова.</p>}
    </Card>
  );
}

// ---------- оформление ----------

export function StudioDesignPanel({
  design,
  authors,
  autoAuthors,
  disabled,
  onChange,
}: {
  design: StudioDesign;
  authors: string;
  autoAuthors: string;
  disabled: boolean;
  onChange: (patch: Partial<StudioDesign>) => void;
}) {
  const id = useId();
  return (
    <Card title="Оформление">
      <fieldset disabled={disabled} className="grid gap-4">
        <div>
          <label htmlFor={`${id}-title`} className={labelClass}>
            Название серии
          </label>
          <input
            id={`${id}-title`}
            className={`${inputClass} mt-1.5`}
            value={design.title}
            maxLength={LIMITS.maxTitleChars}
            placeholder="На масле. Серия 1"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-card`} className={labelClass}>
            Титр
          </label>
          <select
            id={`${id}-card`}
            className={`${inputClass} mt-1.5`}
            value={design.titleCard}
            onChange={(e) => onChange({ titleCard: e.target.value as StudioDesign["titleCard"] })}
          >
            <option value="end">В конце, 1,5 с — как в уроке</option>
            <option value="start">В начале, 1,5 с</option>
            <option value="none">Без титра</option>
          </select>
          <p className={hintClass}>Название, «Сделано с ИИ» и ники авторов. Крючок всё равно — первая сцена.</p>
        </div>
        {design.titleCard !== "none" && (
          <div>
            <label htmlFor={`${id}-authors`} className={labelClass}>
              Авторы
            </label>
            <input
              id={`${id}-authors`}
              className={`${inputClass} mt-1.5`}
              value={authors}
              maxLength={LIMITS.maxAuthorsChars}
              onChange={(e) => onChange({ authors: e.target.value })}
            />
            <p className={hintClass}>
              Только ники, без настоящих фамилий.
              {design.authors !== null && authors !== autoAuthors && (
                <>
                  {" "}
                  <button type="button" className="font-semibold text-violet underline underline-offset-4" onClick={() => onChange({ authors: null })}>
                    Вернуть ники из сцен
                  </button>
                </>
              )}
            </p>
          </div>
        )}
        <div className="grid gap-1">
          <Toggle checked={design.label} onChange={(label) => onChange({ label })} title="«Сделано с ИИ» в углу кадра">
            По правилам курса метка нужна в каждой серии.
          </Toggle>
          <Toggle checked={design.subtitles} onChange={(subtitles) => onChange({ subtitles })} title="Субтитры">
            Из текста реплик, шрифт Onest.
          </Toggle>
          <Toggle checked={design.kenBurns} onChange={(kenBurns) => onChange({ kenBurns })} title="Медленный наезд на картинки">
            Картинка вместо клипа идёт 5 с.
          </Toggle>
          <Toggle checked={design.clipAudio} onChange={(clipAudio) => onChange({ clipAudio })} title="Звук из клипов">
            Обычно выключен: клипы снимаем без слов, голос — репликами.
          </Toggle>
        </div>
      </fieldset>
    </Card>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl py-2">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-violet" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-ink-soft">{children}</span>
      </span>
    </label>
  );
}

// ---------- монтаж и результат ----------

export type RenderState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "running"; progress: EngineProgress | null }
  | { status: "done"; url: string; bytes: number; duration: number; seconds: number }
  | { status: "error"; message: string; fallback: boolean };

export type SaveState =
  | { status: "idle" }
  | { status: "saving"; uploaded: number | null }
  | { status: "saved" }
  | { status: "error"; message: string };

function stageText(progress: EngineProgress | null): string {
  if (!progress) return "Готовим монтаж…";
  if (progress.phase === "core") {
    const { loaded, total, source } = progress.core;
    return `Загружаем модуль монтажа${source === "cdn" ? " (запасной сервер)" : ""}: ${formatMegabytes(loaded)} из ${formatMegabytes(total)}. Это один раз.`;
  }
  const { step } = progress;
  const scene = step.scene !== null ? `Сцена ${step.scene + 1} из ${step.sceneCount}` : "";
  switch (step.stage) {
    case "download":
      return `${scene}: скачиваем файлы`;
    case "render":
      return `${scene}: монтируем`;
    case "title":
      return "Титр";
    case "final":
      return "Сводим звук и музыку";
  }
}

export function StudioRenderPanel({
  duration,
  sceneCount,
  issue,
  estimate,
  render,
  save,
  canSave,
  downloadName,
  onRender,
  onCancel,
  onSave,
}: {
  duration: number;
  sceneCount: number;
  issue: string | null;
  estimate: string;
  render: RenderState;
  save: SaveState;
  canSave: boolean;
  downloadName: string;
  onRender: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const busy = render.status === "running" || render.status === "checking";
  const ratio =
    render.status === "running" && render.progress
      ? render.progress.phase === "core"
        ? render.progress.core.loaded / Math.max(render.progress.core.total, 1)
        : render.progress.ratio
      : 0;
  const eta = render.status === "running" && render.progress?.phase === "pipeline" ? render.progress.etaSeconds : null;

  return (
    <Card title="Смонтировать">
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-lavender px-4 py-3">
          <dt className="font-mono text-xs text-ink-soft">Длительность</dt>
          <dd className={`font-display text-xl font-bold ${duration > LIMITS.maxTotalSeconds ? "text-coral-deep" : ""}`}>
            {formatSeconds(duration)}
            <span className="font-sans text-sm font-normal text-ink-soft"> из {LIMITS.maxTotalSeconds}</span>
          </dd>
        </div>
        <div className="rounded-2xl bg-lavender px-4 py-3">
          <dt className="font-mono text-xs text-ink-soft">Сцены</dt>
          <dd className="font-display text-xl font-bold">
            {sceneCount}
            <span className="font-sans text-sm font-normal text-ink-soft"> из {LIMITS.maxScenes}</span>
          </dd>
        </div>
      </dl>

      {issue && (
        <Notice tone="warn" className="mt-4">
          {issue}
        </Notice>
      )}

      {busy ? (
        <div className="mt-5" aria-live="polite">
          <div
            className="h-3 overflow-hidden rounded-full bg-lavender"
            role="progressbar"
            aria-label="Монтаж"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
          >
            <div className="h-full rounded-full bg-violet transition-[width] duration-300" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </div>
          <p className="mt-3 text-sm">{render.status === "checking" ? "Проверяем тексты…" : stageText(render.status === "running" ? render.progress : null)}</p>
          {render.status === "running" && render.progress?.phase === "pipeline" && (
            <p className="mt-1 font-mono text-xs text-ink-soft">Осталось {formatEta(eta)} · не закрывайте вкладку</p>
          )}
          <button type="button" className={`${buttonClass("secondary")} mt-4 w-full`} onClick={onCancel}>
            <Square aria-hidden="true" className="size-4" /> Остановить
          </button>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-soft">{estimate}</p>
          <button
            type="button"
            className={`${buttonClass("primary")} mt-4 w-full`}
            onClick={onRender}
            disabled={Boolean(issue) || sceneCount === 0}
          >
            <Wand2 aria-hidden="true" className="size-5" /> {render.status === "done" ? "Смонтировать заново" : "Смонтировать"}
            <Badge tone="sun">0 ★</Badge>
          </button>
        </>
      )}

      {render.status === "error" && (
        <Notice tone="error" className="mt-4">
          {render.message}
        </Notice>
      )}

      {render.status === "done" && (
        <div className="mt-6 border-t border-ink/10 pt-5">
          <video
            src={render.url}
            controls
            playsInline
            className="mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-xs rounded-2xl bg-ink"
          />
          <p className="mt-3 text-center font-mono text-xs text-ink-soft">
            {formatSeconds(render.duration)} · {formatMegabytes(render.bytes)} · смонтировано за {formatSeconds(render.seconds)}
          </p>
          <div className="mt-4 grid gap-2">
            <a href={render.url} download={downloadName} className={buttonClass("secondary")}>
              <Download aria-hidden="true" className="size-5" /> Скачать mp4
            </a>
            {save.status === "saved" ? (
              <Notice tone="success">
                Сохранено.{" "}
                <Link href="/app/gallery" className="font-semibold underline underline-offset-4">
                  Открыть галерею
                </Link>
              </Notice>
            ) : (
              <button type="button" className={buttonClass("primary")} onClick={onSave} disabled={!canSave || save.status === "saving"}>
                {save.status === "saving" ? (
                  <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
                ) : (
                  <Save aria-hidden="true" className="size-5" />
                )}
                {save.status === "saving"
                  ? save.uploaded === null
                    ? "Сохраняем…"
                    : `Загружаем: ${Math.round(save.uploaded * 100)} %`
                  : "Сохранить в галерею"}
              </button>
            )}
            {save.status === "error" && <Notice tone="error">{save.message}</Notice>}
          </div>
        </div>
      )}
    </Card>
  );
}
