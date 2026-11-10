"use client";

import { useActionState } from "react";
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
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div>
        <label htmlFor="teacher-score" className={labelClass}>
          Оценка от 1 до 10
        </label>
        <select id="teacher-score" name="score" defaultValue={initial?.score ?? ""} required className={`${inputClass} mt-1 max-w-40`}>
          <option value="" disabled>
            —
          </option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="teacher-comment" className={labelClass}>
          Комментарий <span className="font-normal text-ink-soft">(необязательно)</span>
        </label>
        <textarea
          id="teacher-comment"
          name="comment"
          defaultValue={initial?.comment ?? ""}
          maxLength={MAX_HOMEWORK_NOTE}
          rows={4}
          className={`${inputClass} mt-1 min-h-24 resize-y`}
          placeholder="Что получилось, что доработать к защите"
        />
        <p className={hintClass}>Ученик увидит оценку и комментарий в уроке, рядом с оценкой ИИ.</p>
      </div>
      {state && !state.ok && <Notice tone="error">{errorText(state.error)}</Notice>}
      {state?.ok && <Notice tone="success">Оценка сохранена.</Notice>}
      <SubmitButton pendingText="Сохраняем…">{initial ? "Изменить оценку" : "Поставить оценку"}</SubmitButton>
    </form>
  );
}
