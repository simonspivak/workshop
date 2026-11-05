"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clapperboard, ClipboardPaste, Lock } from "lucide-react";
import { CopyButton } from "@/components/platform/CopyButton";
import { GenerateJobCard } from "@/components/platform/GenerateJobCard";
import { GeneratePanel } from "@/components/platform/GeneratePanel";
import { LessonSteps } from "@/components/platform/LessonSteps";
import { Stars, buttonClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import { jobActionLabels, type GenerateAction, type GenerateActionOption, type JobView, type MediaOption } from "@/lib/platform/generation-types";
import type { LessonStepView } from "@/lib/platform/lesson-types";

/**
 * Задание урока в браузере: шаги с промптами («Вставить в чат» кладёт промпт в запрос чата задания),
 * шаблоны промптов (скопировать или вставить в запрос), кнопки ИИ-действий с ценой,
 * форма генерации и результаты по заданию.
 */
export function LessonTaskTools({
  lessonId,
  taskId,
  steps,
  doneWhen,
  templates,
  options,
  montage,
  results,
  references,
  library,
  staff,
}: {
  lessonId: string;
  taskId: string;
  steps: LessonStepView[];
  doneWhen: string | null;
  templates: string[];
  options: GenerateActionOption[];
  montage: boolean;
  results: JobView[];
  references: MediaOption[];
  library: MediaOption[];
  staff: boolean;
}) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [created, setCreated] = useState<JobView[]>([]);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // запрос «прокрути к полю и поставь курсор»: счётчик, эффект ниже
  const [focusRequest, setFocusRequest] = useState(0);

  const selected = options.find((o) => o.key === selectedKey) ?? null;
  const firstAvailable = options.find((o) => o.available) ?? null;

  // Текст в поле запроса: выбрать действие, дописать или заменить текст, прокрутить к полю.
  // Переписку не трогаем: она живёт в GeneratePanel и в localStorage.
  const insertText = (text: string, { option, replace }: { option: GenerateActionOption | null; replace: boolean }) => {
    if (option) setSelectedKey(option.key);
    setPrompt((current) => (replace || !current.trim() ? text : `${current.trimEnd()}\n\n${text}`));
    setFocusRequest((n) => n + 1);
  };
  // шаблон — в выбранное действие (или первое доступное), дописывается к запросу
  const insertTemplate = (template: string) => insertText(template, { option: selected ?? firstAvailable, replace: false });
  // Промпт из шага — в действие из step.into (по умолчанию в чат задания), заменяет текст запроса.
  // Если уже открыто действие того же типа (в старых уроках бывает два чата), остаёмся в нём:
  // его переписка не должна пропасть с экрана.
  const targetFor = (into: GenerateAction) =>
    selected?.action === into && selected.available
      ? selected
      : (options.find((o) => o.action === into && o.available) ?? null);
  const canInsert = (into: GenerateAction) => targetFor(into) !== null;
  const insertPrompt = (text: string, into: GenerateAction) => {
    const option = targetFor(into);
    if (option) insertText(text, { option, replace: true });
  };

  // после рендера: форма могла только что появиться (выбрано действие), поэтому фокус — в эффекте
  useEffect(() => {
    if (focusRequest === 0) return;
    const field = promptRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusRequest]);

  // новые результаты сверху; после router.refresh() сервер пришлёт их же — не дублируем
  const jobs = useMemo(() => {
    const ids = new Set(created.map((j) => j.id));
    return [...created, ...results.filter((j) => !ids.has(j.id))];
  }, [created, results]);

  const onSettled = useCallback(() => router.refresh(), [router]);

  const canGenerate = options.length > 0;

  return (
    <div className="space-y-5">
      {steps.length > 0 && <LessonSteps steps={steps} onInsert={insertPrompt} canInsert={canInsert} />}

      {doneWhen && (
        <p className="rounded-2xl bg-sun/30 px-4 py-3 text-sm leading-relaxed">
          <span className="font-semibold">Готово, когда: </span>
          {doneWhen}
        </p>
      )}

      {templates.length > 0 && (
        <details className="group rounded-2xl bg-paper ring-1 ring-ink/10" open={templates.length <= 2}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            Шаблоны промптов · {templates.length}
            <span className="text-sm text-violet group-open:hidden">Показать</span>
            <span className="hidden text-sm text-violet group-open:inline">Свернуть</span>
          </summary>
          <ol className="space-y-3 px-4 pb-4">
            {templates.map((template, i) => (
              <li key={i} className="rounded-2xl bg-white p-3 ring-1 ring-ink/10">
                <p className="font-mono text-xs text-ink-soft">Шаблон {i + 1}</p>
                <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">{template}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canGenerate && (
                    <button type="button" onClick={() => insertTemplate(template)} className={buttonClass("secondary", "sm")}>
                      <ClipboardPaste aria-hidden="true" className="size-4" /> Вставить в запрос
                    </button>
                  )}
                  <CopyButton text={template} />
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}

      {(canGenerate || montage) && (
        <div>
          <h4 className="font-mono text-xs tracking-wide text-ink-soft uppercase">ИИ-действия</h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => (
              <li key={option.key}>
                <ActionChip option={option} selected={option.key === selectedKey} staff={staff} onSelect={() => setSelectedKey(option.key)} />
              </li>
            ))}
            {montage && (
              <li>
                <Link href={`/app/studio?lesson=${encodeURIComponent(lessonId)}&task=${encodeURIComponent(taskId)}`} className={`${buttonClass("sun", "sm")} h-full`}>
                  <Clapperboard aria-hidden="true" className="size-4" /> Монтаж · 0 ★ <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            )}
          </ul>
          {options.some((o) => !o.available) && (
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {options
                .filter((o) => !o.available)
                .map((o) => (
                  <li key={o.key} className="flex items-start gap-2">
                    <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {jobActionLabels[o.action]} · {o.modelLabel}: {platformErrorMessage(o.reason)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {selected?.available && (
        <GeneratePanel
          key={selected.key}
          option={selected}
          lessonId={lessonId}
          taskId={taskId}
          prompt={prompt}
          onPromptChange={setPrompt}
          promptRef={promptRef}
          references={references}
          library={library}
          staff={staff}
          onJob={(job) => setCreated((list) => [job, ...list])}
        />
      )}

      {jobs.length > 0 && (
        <div>
          <h4 className="font-mono text-xs tracking-wide text-ink-soft uppercase">Результаты по заданию</h4>
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {jobs.map((job) => (
              <li key={job.id} className={job.action === "text" ? "sm:col-span-2" : ""}>
                <GenerateJobCard job={job} onSettled={onSettled} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">
            Картинки, видео и звук сохраняются в{" "}
            <Link href="/app/gallery" className="font-semibold text-violet underline underline-offset-4">
              галерею
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

function ActionChip({
  option,
  selected,
  staff,
  onSelect,
}: {
  option: GenerateActionOption;
  selected: boolean;
  staff: boolean;
  onSelect: () => void;
}) {
  const label = option.action === "text" ? (option.long ? "Длинный ответ" : "Ответ ИИ") : jobActionLabels[option.action];
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!option.available}
      aria-pressed={selected}
      className={`inline-flex min-h-10 flex-wrap items-center gap-x-2 rounded-full px-4 py-2 text-left text-sm font-semibold ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? "bg-violet text-white ring-violet" : "bg-white text-ink ring-ink/15 hover:bg-lavender"
      }`}
    >
      <span>{label}</span>
      <span className={`font-normal ${selected ? "text-white/80" : "text-ink-soft"}`}>{option.modelLabel}</span>
      <span className="font-mono text-xs">{staff ? "демо" : <Stars value={option.stars} />}</span>
    </button>
  );
}
