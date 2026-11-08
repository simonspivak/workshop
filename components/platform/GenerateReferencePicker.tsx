"use client";

import { useId, useState } from "react";
import { Check, Link2, Music, X } from "lucide-react";
import { PlayButton, useAudioPreview } from "@/components/platform/AudioPreview";
import { useReferenceTray } from "@/components/platform/GenerateClient";
import { buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import type { JobAction, MediaKind, MediaOption } from "@/lib/platform/generation-types";

/**
 * Выбор файлов из своей галереи (и библиотеки курса) для референсов.
 * Сначала — отмеченные в галерее кнопкой «Как референс». Ведущий может вставить https-ссылку.
 * actions — показывать только файлы этих задач (например, озвучку без музыки); файлы без
 * известной задачи (библиотека курса, старые отметки в галерее) тогда не показываются.
 * Звук (озвучка, музыка) можно послушать до выбора: кнопка «Послушать» на плитке, один плеер
 * на панель — новый включился, старый замолчал; панель закрылась — звук остановился.
 */
export function GenerateReferencePicker({
  label,
  hint,
  kind,
  actions,
  options,
  max,
  value,
  onChange,
  allowUrl = false,
  emptyText,
}: {
  label: string;
  hint?: string;
  kind: MediaKind;
  actions?: readonly JobAction[];
  options: MediaOption[];
  max: number;
  value: string[];
  onChange: (paths: string[]) => void;
  allowUrl?: boolean;
  emptyText?: string;
}) {
  const id = useId();
  const tray = useReferenceTray();
  const preview = useAudioPreview();
  const [url, setUrl] = useState("");

  const allowed = (o: { action?: JobAction }) => !actions || (o.action !== undefined && actions.includes(o.action));
  const ofKind = options.filter((o) => o.kind === kind && allowed(o));
  const known = new Set(ofKind.map((o) => o.path));
  const fromTray: MediaOption[] = tray.items
    .filter((item) => item.kind === kind)
    .map(
      (item) =>
        ofKind.find((o) => o.path === item.path) ?? { path: item.path, url: "", kind: item.kind, label: item.label, action: item.action },
    )
    .filter(allowed);
  const trayPaths = new Set(fromTray.map((o) => o.path));
  const extraUrls = value.filter((v) => v.startsWith("https://")).map((v) => ({ path: v, url: "", kind, label: "Ссылка" }));
  const tiles: MediaOption[] = [...extraUrls, ...fromTray, ...ofKind.filter((o) => !trayPaths.has(o.path))];

  const toggle = (path: string) => {
    if (value.includes(path)) onChange(value.filter((v) => v !== path));
    else if (max === 1) onChange([path]);
    else if (value.length < max) onChange([...value, path]);
  };

  return (
    <fieldset className="min-w-0">
      <legend className={labelClass}>{label}</legend>
      {hint && <p className={hintClass}>{hint}</p>}
      {tiles.length === 0 ? (
        <p className="mt-2 rounded-2xl bg-lavender px-4 py-3 text-sm text-ink-soft">
          {emptyText ?? "В галерее пока нет подходящих файлов."}
        </p>
      ) : (
        <ul className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
          {tiles.map((option) => {
            const selected = value.includes(option.path);
            const order = value.indexOf(option.path) + 1;
            const audio = option.kind === "audio";
            const label = trayPaths.has(option.path) && !known.has(option.path) ? "Из галереи" : option.label;
            const title = audio && option.text ? `${option.text} — ${label}` : label;
            return (
              // кнопка «Послушать» — сосед кнопки выбора, не внутри: вложенные кнопки недопустимы,
              // и клик по плееру не должен менять выбор
              <li key={option.path} className="relative shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => toggle(option.path)}
                  aria-pressed={selected}
                  title={title}
                  className={`relative flex h-32 flex-col overflow-hidden rounded-2xl bg-lavender text-left ring-2 transition-shadow ${
                    audio ? "w-40" : "w-24"
                  } ${selected ? "ring-violet" : "ring-transparent hover:ring-glow"}`}
                >
                  <Thumb option={option} />
                  <span className="bg-white/90 px-1.5 py-1 text-[11px] leading-tight">
                    {audio && option.text ? (
                      <>
                        <span className="line-clamp-2 font-medium">{option.text}</span>
                        <span className="block truncate text-ink-soft">{label}</span>
                      </>
                    ) : (
                      <span className="line-clamp-2">{label}</span>
                    )}
                  </span>
                  {selected && (
                    <span className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-violet font-mono text-xs text-white">
                      {max > 1 ? order : <Check aria-hidden="true" className="size-4" />}
                    </span>
                  )}
                </button>
                {audio && option.url && (
                  <PlayButton
                    playing={preview.playing === option.path}
                    onClick={() => preview.toggle(option.path, option.url)}
                    label={title}
                    className="absolute top-4 left-1/2 -translate-x-1/2 bg-white shadow-md"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="font-mono text-xs text-ink-soft" aria-live="polite">
        Выбрано {value.length} из {max}
      </p>
      {allowUrl && (
        <div className="mt-2 flex gap-2">
          <label htmlFor={`${id}-url`} className="sr-only">
            Ссылка на файл
          </label>
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            placeholder="https://… (только ведущий)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={`${inputClass} min-h-10 py-2 text-sm`}
          />
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            disabled={!url.startsWith("https://") || value.length >= max}
            onClick={() => {
              onChange(max === 1 ? [url.trim()] : [...value, url.trim()]);
              setUrl("");
            }}
          >
            <Link2 aria-hidden="true" className="size-4" /> Добавить
          </button>
        </div>
      )}
      {fromTray.length > 0 && (
        <button
          type="button"
          onClick={() => fromTray.forEach((o) => tray.remove(o.path))}
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-violet"
        >
          <X aria-hidden="true" className="size-3" /> Очистить отмеченные в галерее
        </button>
      )}
    </fieldset>
  );
}

function Thumb({ option }: { option: MediaOption }) {
  if (!option.url) {
    return <span className="placeholder-stripes flex-1" aria-hidden="true" />;
  }
  if (option.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки Storage
      <img src={option.url} alt="" loading="lazy" className="min-h-0 flex-1 object-cover" />
    );
  }
  if (option.kind === "video") {
    return <video src={`${option.url}#t=0.1`} muted playsInline preload="metadata" className="min-h-0 flex-1 bg-ink object-cover" />;
  }
  // звук: значок в углу, в центре плитки — кнопка «Послушать» (рисуется рядом с кнопкой выбора)
  return (
    <span className="relative flex-1" aria-hidden="true">
      <Music className="absolute right-1.5 bottom-1 size-4 text-violet/70" />
    </span>
  );
}
