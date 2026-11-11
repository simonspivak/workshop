"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { gradeHomework, type GradeActionResult } from "./actions";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import { MAX_HOMEWORK_NOTE, homeworkErrorMessages } from "@/lib/platform/homework-types";

function errorText(code: string): string {
  return code in homeworkErrorMessages ? homeworkErrorMessages[code as keyof typeof homeworkErrorMessages] : platformErrorMessage(code);
}

/** Оценка ведущего: 1–10 и комментарий. Ученик увидит её рядом с оценкой ИИ. */
export function TeacherGradeForm({
  submissionId,
  initial,
}: {
  submissionId: string;
  initial: { score: number; comment: string | null } | null;
}) {
  const [state, action] = useActionState<GradeActionResult | null, FormData>(gradeHomework, null);
  // Поля управляемые: после успешного действия React сбрасывает форму к defaultValue,
  // и выбранная оценка исчезала с экрана. Начальные значения — то, что уже сохранено.
  const [score, setScore] = useState(initial?.score ? String(initial.score) : "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const scoreRef = useRef<HTMLSelectElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  // После действия React делает form.reset(): у <select> нет «выбранного по умолчанию» пункта,
  // и браузер показывает первый доступный («1»), хотя в состоянии и в базе — сохранённая оценка.
  // Состояние не менялось, React DOM не трогает — возвращаем значения в поля сами.
  useEffect(() => {
    if (scoreRef.current) scoreRef.current.value = score;
    if (commentRef.current) commentRef.current.value = comment;
  }, [state, score, comment]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div>
        <label htmlFor="teacher-score" className={labelClass}>
          Оценка от 1 до 10
        </label>
        <div className="relative mt-1 max-w-40">
          <select
            ref={scoreRef}
            id="teacher-score"
            name="score"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            required
            className={`${inputClass} appearance-none pr-11`}
          >
            <option value="" disabled>
              —
            </option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink-soft" />
        </div>
      </div>
      <div>
        <label htmlFor="teacher-comment" className={labelClass}>
          Комментарий <span className="font-normal text-ink-soft">(необязательно)</span>
        </label>
        <textarea
          ref={commentRef}
          id="teacher-comment"
          name="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={MAX_HOMEWORK_NOTE}
          rows={4}
          className={`${inputClass} mt-1 min-h-24 resize-y`}
          placeholder="Что получилось, что доработать к защите"
        />
        <p className={hintClass}>Ученик увидит оценку и комментарий в уроке, рядом с оценкой ИИ.</p>
      </div>
      {state && !state.ok && <Notice tone="error">{errorText(state.error)}</Notice>}
      {state?.ok && (
        <Notice tone="success">
          Сохранено: {score}/10{comment.trim() ? ` — «${comment.trim()}»` : ""}. Ученик уже видит это в уроке.
        </Notice>
      )}
      <SubmitButton pendingText="Сохраняем…">{initial ? "Изменить оценку" : "Поставить оценку"}</SubmitButton>
    </form>
  );
}
