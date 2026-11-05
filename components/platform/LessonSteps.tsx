"use client";

import { ClipboardPaste, Lightbulb } from "lucide-react";
import { CopyButton } from "@/components/platform/CopyButton";
import { buttonClass } from "@/components/platform/ui";
import type { GenerateAction } from "@/lib/platform/generation-types";
import type { LessonStepView } from "@/lib/platform/lesson-types";

/** Подпись кнопки «Вставить…» по действию, куда уходит промпт. */
export const INSERT_LABELS: Record<GenerateAction, string> = {
  text: "Вставить в чат",
  image: "Вставить в Картинку",
  image_edit: "Вставить в Правку картинки",
  video: "Вставить в Видео",
  motion: "Вставить в Перенос движения",
  lipsync: "Вставить в Говорящую голову",
  voice: "Вставить в Озвучку",
  music: "Вставить в Музыку",
};

/** Вставка промпта в действие задания; null — такого действия в задании нет или оно недоступно. */
export type InsertPrompt = (prompt: string, into: GenerateAction) => void;

/** Номера промптов по порядку шагов: первый промпт в задании (или домашке) — «Промпт 1». */
function promptNumbers(steps: readonly LessonStepView[]): (number | null)[] {
  const numbers: (number | null)[] = [];
  let count = 0;
  for (const step of steps) numbers.push(step.prompt ? ++count : null);
  return numbers;
}

/**
 * Шаги задания или домашки: нумерованный список, у шага с промптом — рамка «Промпт N»
 * с кнопками «Вставить в …» (в чат или в действие из step.into, если оно есть в задании) и «Копировать»,
 * подсказка — заметкой.
 */
export function LessonSteps({
  steps,
  onInsert,
  canInsert,
}: {
  steps: LessonStepView[];
  onInsert?: InsertPrompt;
  canInsert?: (into: GenerateAction) => boolean;
}) {
  const numbers = promptNumbers(steps);
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lavender font-mono text-sm font-semibold"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="leading-relaxed break-words whitespace-pre-line">
              <span className="sr-only">Шаг {i + 1}. </span>
              {step.text}
            </p>
            {step.prompt && (
              <PromptBox
                n={numbers[i] ?? 0}
                prompt={step.prompt}
                into={step.into ?? "text"}
                onInsert={onInsert && canInsert?.(step.into ?? "text") ? onInsert : undefined}
              />
            )}
            {step.tip && (
              <p className="mt-2 flex gap-2 text-sm leading-relaxed text-ink-soft">
                <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  <span className="sr-only">Подсказка: </span>
                  {step.tip}
                </span>
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// На телефоне рамка промпта на всю ширину шага (под номером тоже): моноширинному тексту нужно место
function PromptBox({
  n,
  prompt,
  into,
  onInsert,
}: {
  n: number;
  prompt: string;
  into: GenerateAction;
  onInsert?: InsertPrompt;
}) {
  return (
    <figure className="mt-3 -ml-10 rounded-2xl bg-paper ring-1 ring-ink/10 sm:ml-0">
      <figcaption className="border-b border-ink/10 px-3 py-2 text-sm font-semibold sm:px-4">Промпт {n}</figcaption>
      <pre className="px-3 py-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap sm:px-4">{prompt}</pre>
      <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
        {onInsert && (
          <button type="button" onClick={() => onInsert(prompt, into)} className={buttonClass("primary", "sm")}>
            <ClipboardPaste aria-hidden="true" className="size-4" /> {INSERT_LABELS[into]}
          </button>
        )}
        <CopyButton text={prompt} />
      </div>
    </figure>
  );
}
