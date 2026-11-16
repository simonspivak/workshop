"use client";

import { useState } from "react";
import { Check, Images, LoaderCircle, X } from "lucide-react";
import { AttachmentCaption, AttachmentMedia, attachmentSummary } from "@/components/platform/HomeworkAttachments";
import { buttonClass, hintClass, labelClass } from "@/components/platform/ui";
import { GALLERY_AI_HINT, MAX_HOMEWORK_ATTACHMENTS, type HomeworkAttachmentView } from "@/lib/platform/homework-types";

/*
  «Прикрепить из галереи» в форме домашки: свои готовые картинки, видео, озвучка, музыка и монтаж
  (GET /api/homework/gallery, новые первыми). Выбор до MAX_HOMEWORK_ATTACHMENTS, выбранное —
  списком под кнопкой, каждый можно убрать. Файлы не копируются: в сдачу уходят id результатов.
*/

type ListBody = { ok: true; items: HomeworkAttachmentView[] } | { ok: false; error: string };

export function HomeworkGalleryPicker({
  value,
  onChange,
  disabled,
}: {
  value: HomeworkAttachmentView[];
  onChange: (next: HomeworkAttachmentView[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ name: "idle" } | { name: "loading" } | { name: "error" } | { name: "ready"; items: HomeworkAttachmentView[] }>({
    name: "idle",
  });
  const selected = new Set(value.map((v) => v.jobId));
  const full = value.length >= MAX_HOMEWORK_ATTACHMENTS;

  const load = async () => {
    setState({ name: "loading" });
    try {
      const response = await fetch("/api/homework/gallery", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ListBody | null;
      setState(body?.ok ? { name: "ready", items: body.items } : { name: "error" });
    } catch {
      setState({ name: "error" });
    }
  };

  const toggle = (item: HomeworkAttachmentView) => {
    if (selected.has(item.jobId)) onChange(value.filter((v) => v.jobId !== item.jobId));
    else if (!full) onChange([...value, item]);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && state.name !== "ready") void load();
          }}
          className={buttonClass("secondary", "sm")}
        >
          <Images aria-hidden="true" className="size-4" /> {open ? "Скрыть галерею" : "Прикрепить из галереи"}
        </button>
        <span className="text-sm text-ink-soft" aria-live="polite">
          {value.length ? `Прикреплено ${value.length} из ${MAX_HOMEWORK_ATTACHMENTS}: ${attachmentSummary(value)}` : "Клипы, картинки и звук, которые ты сделал на платформе"}
        </span>
      </div>

      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {value.map((item, i) => (
            <li key={item.jobId} className="flex w-28 flex-col rounded-xl bg-white p-1.5 ring-1 ring-ink/10">
              <AttachmentMedia item={item} compact />
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="font-mono text-[11px] text-ink-soft">№{i + 1}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(item)}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-coral-deep hover:underline"
                >
                  <X aria-hidden="true" className="size-3" /> Убрать
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <fieldset className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-ink/10">
          <legend className={`${labelClass} px-1`}>Твоя галерея</legend>
          {state.name === "loading" || state.name === "idle" ? (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Загружаем галерею…
            </p>
          ) : state.name === "error" ? (
            <p className="text-sm text-coral-deep">
              Не удалось загрузить галерею.{" "}
              <button type="button" onClick={() => void load()} className="font-semibold underline">
                Ещё раз
              </button>
            </p>
          ) : state.items.length === 0 ? (
            <p className="text-sm text-ink-soft">В галерее пока нет готовых картинок, видео или звука.</p>
          ) : (
            <>
              <p className={hintClass}>
                Отметь нужные (до {MAX_HOMEWORK_ATTACHMENTS}). {GALLERY_AI_HINT}
              </p>
              <ul className="mt-3 grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                {state.items.map((item) => {
                  const on = selected.has(item.jobId);
                  return (
                    <li key={item.jobId} className="relative min-w-0">
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={disabled || (!on && full)}
                        onClick={() => toggle(item)}
                        className={`block w-full rounded-2xl p-1.5 text-left ring-2 transition-shadow disabled:opacity-50 ${
                          on ? "bg-lavender ring-violet" : "bg-paper ring-transparent hover:ring-glow"
                        }`}
                      >
                        <AttachmentMedia item={item} compact />
                        <AttachmentCaption item={item} />
                      </button>
                      {on && (
                        <span className="pointer-events-none absolute top-2.5 right-2.5 inline-flex size-6 items-center justify-center rounded-full bg-violet text-white">
                          <Check aria-hidden="true" className="size-4" />
                        </span>
                      )}
                      {/* послушать или посмотреть до выбора — рядом с кнопкой, не внутри (вложенные элементы управления недопустимы) */}
                      {item.url && item.kind === "audio" && <audio src={item.url} controls preload="none" className="mt-1 h-8 w-full" />}
                      {item.url && item.kind === "video" && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-violet hover:underline">
                          Смотреть<span className="sr-only"> (откроется в новой вкладке)</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </fieldset>
      )}
    </div>
  );
}
