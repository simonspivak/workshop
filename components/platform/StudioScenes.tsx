"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from "lucide-react";
import { LIMITS, type SceneSegment } from "@/lib/platform/montage/args";
import { formatSeconds } from "@/lib/platform/montage/messages";
import type { MediaIndex, StudioScene } from "@/lib/platform/montage/project";
import type { StudioMediaItem } from "@/lib/platform/montage/types";
import { Badge, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { PlayButton } from "@/components/platform/AudioPreview";
import { StudioThumb } from "@/components/platform/StudioThumb";

type SceneActions = {
  move: (key: string, delta: -1 | 1) => void;
  remove: (key: string) => void;
  setLine: (key: string, lineId: string | null) => void;
  setSubtitle: (key: string, text: string) => void;
};

/** Список сцен по порядку: превью, реплика, субтитр, кнопки «выше/ниже/убрать». */
export function StudioSceneList({
  scenes,
  media,
  voices,
  segments,
  subtitlesOn,
  disabled,
  preview,
  actions,
}: {
  scenes: StudioScene[];
  media: MediaIndex;
  voices: StudioMediaItem[];
  /** сегменты предпросмотра по номеру сцены (длительность, стоп-кадр) */
  segments: ReadonlyMap<number, SceneSegment>;
  subtitlesOn: boolean;
  disabled: boolean;
  preview: { playing: string | null; toggle: (id: string, url: string) => void };
  actions: SceneActions;
}) {
  return (
    <ol className="space-y-3">
      {scenes.map((scene, index) => {
        const item = media.get(scene.mediaId);
        if (!item) return null;
        return (
          <SceneCard
            key={scene.key}
            scene={scene}
            item={item}
            index={index}
            count={scenes.length}
            segment={segments.get(index)}
            voices={voices}
            line={scene.lineId ? (media.get(scene.lineId) ?? null) : null}
            subtitlesOn={subtitlesOn}
            disabled={disabled}
            preview={preview}
            actions={actions}
          />
        );
      })}
    </ol>
  );
}

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full text-ink-soft ring-1 ring-ink/10 transition-colors " +
  "hover:bg-lavender hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent";

function SceneCard({
  scene,
  item,
  index,
  count,
  segment,
  voices,
  line,
  subtitlesOn,
  disabled,
  preview,
  actions,
}: {
  scene: StudioScene;
  item: StudioMediaItem;
  index: number;
  count: number;
  segment: SceneSegment | undefined;
  voices: StudioMediaItem[];
  line: StudioMediaItem | null;
  subtitlesOn: boolean;
  disabled: boolean;
  preview: { playing: string | null; toggle: (id: string, url: string) => void };
  actions: SceneActions;
}) {
  const id = useId();
  const n = index + 1;
  const freeze = segment && segment.freeze > 0.05 ? segment.freeze : 0;

  return (
    <li className="rounded-3xl bg-white p-4 ring-1 ring-ink/10 sm:p-5">
      <div className="flex gap-3 sm:gap-4">
        <StudioThumb item={item} className="w-20 shrink-0 sm:w-24" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="pt-1 font-mono text-xs text-ink-soft">
              Сцена {n}
              {segment ? ` · ${formatSeconds(segment.duration)}` : ""}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                className={iconButton}
                onClick={() => actions.move(scene.key, -1)}
                disabled={disabled || index === 0}
                aria-label={`Сцену ${n} выше`}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                className={iconButton}
                onClick={() => actions.move(scene.key, 1)}
                disabled={disabled || index === count - 1}
                aria-label={`Сцену ${n} ниже`}
              >
                <ArrowDown aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                className={iconButton}
                onClick={() => actions.remove(scene.key)}
                disabled={disabled}
                aria-label={`Убрать сцену ${n}`}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
          <p className="mt-1 line-clamp-2 font-semibold leading-snug">{item.title}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.kind === "image" && <Badge>картинка · 5 с</Badge>}
            {!item.own && <Badge>из группы{item.author ? ` · ${item.author}` : ""}</Badge>}
            {index === 0 && count > 1 && <Badge tone="sun">крючок</Badge>}
            {index === count - 1 && count > 1 && <Badge tone="sun">финал</Badge>}
          </div>
          {freeze > 0 && (
            <p className="mt-2 text-sm text-ink-soft">
              Реплика длиннее клипа: последний кадр постоит ещё {formatSeconds(freeze)}.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <label htmlFor={`${id}-line`} className={labelClass}>
            Реплика
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <select
              id={`${id}-line`}
              className={`${inputClass} min-w-0`}
              value={scene.lineId ?? ""}
              disabled={disabled}
              onChange={(e) => actions.setLine(scene.key, e.target.value || null)}
            >
              <option value="">Без голоса</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.title}
                  {voice.own ? "" : ` — ${voice.author ?? "группа"}`}
                </option>
              ))}
            </select>
            {line && (
              <PlayButton
                playing={preview.playing === line.id}
                onClick={() => preview.toggle(line.id, line.url)}
                label={line.title}
              />
            )}
          </div>
        </div>
        {subtitlesOn && (
          <div>
            <label htmlFor={`${id}-sub`} className={labelClass}>
              Субтитр
            </label>
            <textarea
              id={`${id}-sub`}
              rows={2}
              maxLength={LIMITS.maxSubtitleChars}
              className={`${inputClass} mt-1.5 resize-y`}
              value={scene.subtitle}
              disabled={disabled}
              placeholder={line ? "Текст реплики" : "Без голоса субтитр всё равно можно оставить"}
              onChange={(e) => actions.setSubtitle(scene.key, e.target.value)}
            />
            <p className={hintClass}>
              {line ? "Из текста реплики. Опечатка здесь — опечатка на экране." : "Пусто — без субтитра в этой сцене."}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

/** Выбор клипов и картинок из галереи. Можно добавить несколько подряд. */
export function StudioPicker({
  items,
  shareGallery,
  sceneCount,
  onAdd,
  onClose,
}: {
  items: StudioMediaItem[];
  shareGallery: boolean;
  sceneCount: number;
  onAdd: (item: StudioMediaItem) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"own" | "group">("own");
  const [added, setAdded] = useState<Record<string, number>>({});
  const visual = items.filter((i) => i.kind === "video" || i.kind === "image");
  const own = visual.filter((i) => i.own);
  const group = visual.filter((i) => !i.own);
  const list = tab === "own" ? own : group;
  const full = sceneCount >= LIMITS.maxScenes;

  return (
    <section aria-label="Клипы и картинки из галереи" className="rounded-3xl bg-lavender p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Чьи генерации">
          <TabButton active={tab === "own"} onClick={() => setTab("own")}>
            Мои · {own.length}
          </TabButton>
          {shareGallery && (
            <TabButton active={tab === "group"} onClick={() => setTab("group")}>
              Группа · {group.length}
            </TabButton>
          )}
        </div>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={onClose}>
          <X aria-hidden="true" className="size-4" /> Готово
        </button>
      </div>
      {full && <p className="mt-3 text-sm text-ink-soft">Уже {LIMITS.maxScenes} сцен — больше в один ролик не поместится.</p>}
      {list.length === 0 ? (
        <p className="mt-4 text-ink-soft">
          {tab === "own"
            ? "Здесь пока пусто: готовые клипы и картинки из уроков появятся сами."
            : "Одногруппники ещё ничего не сгенерировали."}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={full}
                onClick={() => {
                  onAdd(item);
                  setAdded((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
                }}
                className="group block w-full text-left disabled:opacity-50"
                aria-label={`Добавить: ${item.title}${item.duration ? `, ${formatSeconds(item.duration)}` : ""}`}
              >
                <span className="relative block">
                  <StudioThumb item={item} className="ring-violet transition-shadow group-hover:ring-2" />
                  <span className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full bg-white text-violet shadow">
                    {added[item.id] ? <Check aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
                  </span>
                </span>
                <span className="mt-1.5 line-clamp-2 text-xs leading-snug">{item.title}</span>
                {!item.own && item.author && <span className="block font-mono text-[11px] text-ink-soft">{item.author}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-colors ${
        active ? "bg-violet text-white" : "bg-white text-ink hover:bg-glow"
      }`}
    >
      {children}
    </button>
  );
}
