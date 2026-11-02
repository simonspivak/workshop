"use client";

import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { RichText } from "@/components/platform/RichText";
import { Sparkles } from "lucide-react";
import { newIdempotencyKey, postGenerate } from "@/components/platform/GenerateClient";
import { GenerateReferencePicker } from "@/components/platform/GenerateReferencePicker";
import { Notice, Stars, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import {
  ASPECT_RATIOS,
  VOICE_OPTIONS,
  type AspectRatio,
  type GenerateActionOption,
  type JobView,
  type MediaOption,
  type VoiceId,
} from "@/lib/platform/generation-types";

const PROMPT_LABELS: Record<GenerateActionOption["action"], string> = {
  text: "Запрос",
  image: "Что нарисовать",
  image_edit: "Что изменить или собрать",
  video: "Что происходит в кадре",
  motion: "Подсказка (необязательно)",
  lipsync: "Подсказка (необязательно)",
  voice: "Текст реплики",
  music: "Музыка: стиль, настроение, инструменты",
};

const PROMPT_LIMITS: Record<GenerateActionOption["action"], number> = {
  text: 5000,
  image: 5000,
  image_edit: 5000,
  video: 5000,
  motion: 5000,
  lipsync: 5000,
  voice: 2000,
  music: 1000,
};

export function GeneratePanel({
  option,
  lessonId,
  taskId,
  prompt,
  onPromptChange,
  promptRef,
  references,
  library,
  staff,
  onJob,
}: {
  option: GenerateActionOption;
  lessonId?: string;
  taskId?: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  promptRef?: RefObject<HTMLTextAreaElement | null>;
  references: MediaOption[];
  library: MediaOption[];
  staff: boolean;
  onJob: (job: JobView) => void;
}) {
  const id = useId();
  const action = option.action;
  const [model, setModel] = useState(option.model);
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [images, setImages] = useState<string[]>([]);
  const [driver, setDriver] = useState<string[]>([]);
  const [voiceTrack, setVoiceTrack] = useState<string[]>([]);
  const [referenceMode, setReferenceMode] = useState(false);
  const [duration, setDuration] = useState(5);
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState<VoiceId>("Kore");
  const [style, setStyle] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  // Переписка текстового задания: хранится в браузере, уходит в запрос как история
  const threadKey = action === "text" ? `iis-thread:${lessonId ?? "-"}:${taskId ?? "-"}:${option.key}` : null;
  // Панель монтируется только в браузере (после выбора действия), поэтому читаем хранилище сразу
  const [thread, setThread] = useState<ThreadTurn[]>(() => readThread(threadKey));
  function saveThread(next: ThreadTurn[]) {
    setThread(next);
    if (!threadKey) return;
    try {
      if (next.length) window.localStorage.setItem(threadKey, JSON.stringify(next.slice(-40)));
      else window.localStorage.removeItem(threadKey);
    } catch {
      /* игнорируем */
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // один ключ на одно намерение: повтор после сбоя сети не спишет второй раз
  const keyRef = useRef<string | null>(null);

  const stars = staff ? 0 : action === "video" && duration > 5 ? (option.longStars ?? option.stars) : option.stars;
  const promptRequired = action !== "motion" && action !== "lipsync";
  const maxImages = action === "image_edit" ? 4 : action === "video" ? (referenceMode ? 4 : 2) : 1;
  const needsImages = action === "image_edit" || action === "motion" || action === "lipsync";
  const driverOptions = staff ? [...library, ...references.filter((r) => r.kind === "video")] : library;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (promptRequired && !prompt.trim()) return setError("invalid_input");
    if (needsImages && images.length === 0) return setError("reference_required");
    if (action === "motion" && driver.length === 0) return setError("reference_required");
    if (action === "lipsync" && voiceTrack.length === 0) return setError("reference_required");

    keyRef.current ??= newIdempotencyKey();
    const body: Record<string, unknown> = {
      action,
      model: staff ? model : option.model,
      idempotencyKey: keyRef.current,
      lessonId,
      taskId,
    };
    const text = prompt.trim();
    switch (action) {
      case "text":
        Object.assign(body, { prompt: text, long: option.long, history: thread.length ? thread : undefined });
        break;
      case "image":
        Object.assign(body, { prompt: text, aspectRatio: aspect });
        break;
      case "image_edit":
        Object.assign(body, { prompt: text, images, aspectRatio: aspect });
        break;
      case "video":
        Object.assign(body, {
          prompt: text,
          images: images.length ? images : undefined,
          reference: referenceMode || undefined,
          duration,
          aspectRatio: aspect,
          audio: sound,
        });
        break;
      case "motion":
        Object.assign(body, { images, video: driver[0], prompt: text || undefined });
        break;
      case "lipsync":
        Object.assign(body, { images, audio: voiceTrack[0], prompt: text || undefined });
        break;
      case "voice":
        Object.assign(body, { text, voice, style: style.trim() || undefined });
        break;
      case "music":
        Object.assign(body, {
          prompt: text,
          instrumental,
          lyrics: instrumental ? undefined : lyrics.trim() || undefined,
          title: title.trim() || undefined,
        });
        break;
    }

    setPending(true);
    const result = await postGenerate(body);
    setPending(false);
    if (!result.ok) {
      if (!result.network) keyRef.current = null;
      setError(result.error);
      return;
    }
    keyRef.current = null;
    if (action === "text" && result.job?.text) {
      saveThread([...thread, { role: "user", text }, { role: "assistant", text: result.job.text }]);
      onPromptChange("");
      if (result.balance !== null && !staff) {
        setInfo(stars > 0 ? `Списано ${stars} ★, осталось ${result.balance.toLocaleString("ru-RU")} ★.` : null);
      }
      return;
    }
    if (result.balance !== null && !staff) {
      setInfo(stars > 0 ? `Списано ${stars} ★, осталось ${result.balance.toLocaleString("ru-RU")} ★.` : null);
    }
    onJob(
      result.job ?? {
        id: result.jobId,
        action,
        model: staff ? model : option.model,
        status: "queued",
        stars,
        prompt: action === "voice" ? text : text || null,
        text: null,
        media: [],
        error: null,
        hidden: false,
        lessonId: lessonId ?? null,
        taskRef: taskId ?? null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl bg-lavender/60 p-4 sm:p-5" aria-busy={pending}>
      {action === "text" && thread.length > 0 && (
        <div className="space-y-3">
          <ol className="space-y-3" aria-label="Переписка с ИИ">
            {thread.map((turn, i) => (
              <li
                key={i}
                className={
                  turn.role === "user"
                    ? "ml-6 rounded-2xl bg-violet px-4 py-3 text-white sm:ml-16"
                    : "mr-6 rounded-2xl bg-white px-4 py-3 ring-1 ring-ink/10 sm:mr-16"
                }
              >
                <span className="sr-only">{turn.role === "user" ? "Вы:" : "ИИ:"}</span>
                {turn.role === "user" ? (
                  <p className="line-clamp-6 break-words whitespace-pre-wrap">{turn.text}</p>
                ) : (
                  <RichText text={turn.text} className="leading-relaxed" />
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-soft">
            <span>Напишите ответ ниже — ИИ помнит весь разговор. Каждое сообщение — {stars} ★.</span>
            <button type="button" onClick={() => saveThread([])} className="font-semibold text-violet underline-offset-4 hover:underline">
              Новый диалог
            </button>
          </div>
        </div>
      )}
      {staff && option.models.length > 1 && (
        <div>
          <label htmlFor={`${id}-model`} className={labelClass}>
            Модель (демо ведущего, без звёзд)
          </label>
          <select id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} className={`${inputClass} mt-2`}>
            {option.models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {(action === "image_edit" || action === "video" || action === "motion" || action === "lipsync") && (
        <>
          {action === "video" && (
            <fieldset>
              <legend className={labelClass}>Как использовать картинки</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ModeChoice
                  name={`${id}-mode`}
                  checked={!referenceMode}
                  onChange={() => {
                    setReferenceMode(false);
                    setImages((v) => v.slice(0, 2));
                  }}
                  title="Из кадра"
                  text="Картинка станет первым кадром (вторая — последним)."
                />
                <ModeChoice
                  name={`${id}-mode`}
                  checked={referenceMode}
                  onChange={() => setReferenceMode(true)}
                  title="По листу персонажа"
                  text="Картинки — референсы: герой в новой сцене."
                />
              </div>
            </fieldset>
          )}
          <GenerateReferencePicker
            label={action === "image_edit" ? "Картинки из галереи" : action === "video" ? "Картинки (необязательно)" : "Персонаж"}
            hint={
              action === "motion"
                ? "Кадр героя в полный рост: видны голова, плечи и торс."
                : action === "lipsync"
                  ? "Портрет героя, лицо крупно."
                  : undefined
            }
            kind="image"
            options={references}
            max={maxImages}
            value={images}
            onChange={setImages}
            allowUrl={staff}
            emptyText="Картинок в галерее пока нет. Сначала сгенерируйте кадр или лист персонажа."
          />
        </>
      )}

      {action === "motion" && (
        <GenerateReferencePicker
          label="Движение"
          hint={staff ? "Драйвер из библиотеки курса, свой клип или ссылка." : "Драйверы из библиотеки курса: танец, походка, жест."}
          kind="video"
          options={driverOptions}
          max={1}
          value={driver}
          onChange={setDriver}
          allowUrl={staff}
          emptyText="Библиотека движений пока пуста."
        />
      )}

      {action === "lipsync" && (
        <GenerateReferencePicker
          label="Озвучка"
          hint="Своя реплика из галереи (озвучка)."
          kind="audio"
          options={references}
          max={1}
          value={voiceTrack}
          onChange={setVoiceTrack}
          allowUrl={staff}
          emptyText="Озвучек в галерее пока нет. Сначала озвучьте реплику."
        />
      )}

      <div>
        <label htmlFor={`${id}-prompt`} className={labelClass}>
          {PROMPT_LABELS[action]}
        </label>
        <textarea
          id={`${id}-prompt`}
          ref={promptRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          required={promptRequired}
          maxLength={PROMPT_LIMITS[action]}
          rows={action === "text" ? 6 : 5}
          placeholder="Вставьте шаблон из задания и допишите своё"
          className={`${inputClass} mt-2 font-normal`}
        />
        <p className={hintClass}>Без имён реальных людей и без личных данных: телефонов, адресов, e-mail.</p>
      </div>

      {action === "voice" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-voice`} className={labelClass}>
              Голос
            </label>
            <select id={`${id}-voice`} value={voice} onChange={(e) => setVoice(e.target.value as VoiceId)} className={`${inputClass} mt-2`}>
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-style`} className={labelClass}>
              Манера речи
            </label>
            <input
              id={`${id}-style`}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              maxLength={300}
              placeholder="Например: с иронией, быстро, шёпотом"
              className={`${inputClass} mt-2`}
            />
          </div>
        </div>
      )}

      {action === "music" && (
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="mt-1 size-5 accent-violet" />
            <span>Без вокала (только музыка)</span>
          </label>
          {!instrumental && (
            <div>
              <label htmlFor={`${id}-lyrics`} className={labelClass}>
                Текст песни (необязательно)
              </label>
              <textarea
                id={`${id}-lyrics`}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                maxLength={3000}
                rows={4}
                className={`${inputClass} mt-2`}
              />
            </div>
          )}
          <div>
            <label htmlFor={`${id}-title`} className={labelClass}>
              Название (необязательно)
            </label>
            <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={`${inputClass} mt-2`} />
          </div>
        </div>
      )}

      {(action === "image" || action === "image_edit" || action === "video") && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-aspect`} className={labelClass}>
              Формат кадра
            </label>
            <select id={`${id}-aspect`} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)} className={`${inputClass} mt-2`}>
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio === "9:16" ? "9:16 — вертикальный, для Reels" : ratio}
                </option>
              ))}
            </select>
          </div>
          {action === "video" && (
            <div>
              <label htmlFor={`${id}-duration`} className={labelClass}>
                Длительность
              </label>
              <select
                id={`${id}-duration`}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={`${inputClass} mt-2`}
              >
                <option value={5}>5 секунд{staff ? "" : ` · ${option.stars} ★`}</option>
                {option.longStars !== null && <option value={10}>10 секунд{staff ? "" : ` · ${option.longStars} ★`}</option>}
              </select>
            </div>
          )}
        </div>
      )}

      {action === "video" && (
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="mt-1 size-5 accent-violet" />
          <span>
            Звук модели
            <span className="block text-sm text-ink-soft">Обычно выключен: по-русски модель говорит неразборчиво, реплики озвучиваем отдельно.</span>
          </span>
        </label>
      )}

      {error && <Notice tone="error">{platformErrorMessage(error)}</Notice>}
      {info && <Notice tone="success">{info}</Notice>}

      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        <Sparkles aria-hidden="true" className="size-5" />
        {pending ? (action === "text" ? "Думает…" : "Отправляем…") : "Сгенерировать"}
        {!pending && (staff ? <span className="font-mono text-sm opacity-80">· демо</span> : <span className="font-mono text-sm opacity-90">· <Stars value={stars} /></span>)}
      </button>
    </form>
  );
}

function ModeChoice({
  name,
  checked,
  onChange,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  text: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-3 ring-2 ${checked ? "ring-violet" : "ring-transparent"}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-4 accent-violet" />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-ink-soft">{text}</span>
      </span>
    </label>
  );
}

type ThreadTurn = { role: "user" | "assistant"; text: string };

function readThread(key: string | null): ThreadTurn[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as ThreadTurn[]) : [];
  } catch {
    return [];
  }
}
