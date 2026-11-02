"use client";

import { useActionState, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { submitQuiz, type QuizActionResult } from "./actions";
import { Notice, Stars, buttonClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import type { LessonQuestionView, QuizResultView } from "@/lib/platform/lesson-types";

/** Тест урока. Ответы проверяет сервер; правильные ответы и объяснения приходят только после отправки. */
type BonusRule = { stars: number; minScore: number };

export function QuizForm({
  lessonId,
  questions,
  initial,
  bonus,
}: {
  lessonId: string;
  questions: LessonQuestionView[];
  initial: QuizResultView | null;
  bonus: BonusRule;
}) {
  const [round, setRound] = useState(0);
  return (
    <QuizRound
      key={round}
      lessonId={lessonId}
      questions={questions}
      initial={round === 0 ? initial : null}
      bonus={bonus}
      onRetry={() => setRound((r) => r + 1)}
    />
  );
}

function QuizRound({
  lessonId,
  questions,
  initial,
  bonus,
  onRetry,
}: {
  lessonId: string;
  questions: LessonQuestionView[];
  initial: QuizResultView | null;
  bonus: BonusRule;
  onRetry: () => void;
}) {
  const [state, action, pending] = useActionState<QuizActionResult | null, FormData>(submitQuiz, null);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const result = state?.ok ? state.result : initial;

  if (result) {
    return <QuizResult questions={questions} result={result} bonus={bonus} onRetry={result.practice ? onRetry : undefined} />;
  }

  const answered = answers.filter((a) => a !== null).length;
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="lessonId" value={lessonId} />
      <p className="text-ink-soft">
        {questions.length} вопросов, засчитывается одна попытка. За {bonus.minScore} и больше правильных — бонус{" "}
        <Stars value={bonus.stars} />.
      </p>
      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={i}>
            <fieldset className="rounded-3xl bg-white p-4 ring-1 ring-ink/10 sm:p-5">
              <legend className="sr-only">Вопрос {i + 1}</legend>
              <p className="font-semibold">
                <span className="font-mono text-sm text-ink-soft">{i + 1}. </span>
                {q.question}
              </p>
              <div className="mt-3 space-y-2">
                {q.options.map((option, j) => (
                  <label
                    key={j}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-2.5 ring-1 ${
                      answers[i] === j ? "bg-lavender ring-violet" : "ring-ink/10 hover:bg-paper"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q${i}`}
                      value={j}
                      required
                      checked={answers[i] === j}
                      onChange={() => setAnswers((list) => list.map((a, k) => (k === i ? j : a)))}
                      className="mt-1 size-4 shrink-0 accent-violet"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {state && !state.ok && <Notice tone="error">{platformErrorMessage(state.error)}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Проверяем…" : "Отправить ответы"}
        </button>
        <span className="font-mono text-sm text-ink-soft">
          Отвечено {answered} из {questions.length}
        </span>
      </div>
    </form>
  );
}

function QuizResult({
  questions,
  result,
  bonus,
  onRetry,
}: {
  questions: LessonQuestionView[];
  result: QuizResultView;
  bonus: BonusRule;
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="on-dark rounded-3xl bg-violet p-5 text-white sm:p-6">
        <p className="font-mono text-xs tracking-wide text-white/75 uppercase">
          {result.practice ? "Тренировка ведущего · не записано" : result.alreadyDone ? "Тест засчитан" : "Результат"}
        </p>
        <p className="mt-2 font-display text-4xl font-bold">
          {result.score} из {result.maxScore}
        </p>
        {result.bonus > 0 ? (
          <p className="mt-2 text-white/90">
            Бонус: +<Stars value={result.bonus} />
          </p>
        ) : (
          !result.practice && (
            <p className="mt-2 text-white/80">
              Бонус — за {bonus.minScore} из {result.maxScore} и больше. Разберите ошибки ниже.
            </p>
          )
        )}
      </div>

      {result.items.length > 0 && (
        <ol className="space-y-3">
          {result.items.map((item, i) => {
            const q = questions[i];
            if (!q) return null;
            return (
              <li key={i} className="rounded-3xl bg-white p-4 ring-1 ring-ink/10 sm:p-5">
                <p className="flex items-start gap-2 font-semibold">
                  {item.correct ? (
                    <Check aria-label="Верно" className="mt-0.5 size-5 shrink-0 text-violet" />
                  ) : (
                    <X aria-label="Неверно" className="mt-0.5 size-5 shrink-0 text-coral-deep" />
                  )}
                  <span>
                    <span className="font-mono text-sm text-ink-soft">{i + 1}. </span>
                    {q.question}
                  </span>
                </p>
                {!item.correct && (
                  <p className="mt-2 text-sm text-ink-soft">
                    Ваш ответ: <span className="text-coral-deep">{q.options[item.chosen]}</span>
                  </p>
                )}
                <p className="mt-1 text-sm">
                  Верно: <span className="font-semibold">{q.options[item.correctIndex]}</span>
                </p>
                {item.explanation && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.explanation}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass("secondary", "sm")}>
          <RotateCcw aria-hidden="true" className="size-4" /> Пройти ещё раз
        </button>
      )}
    </div>
  );
}
