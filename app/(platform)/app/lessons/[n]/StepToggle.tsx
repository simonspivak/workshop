"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { toggleLessonStep, type StepActionResult } from "./actions";
import { buttonClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";

/** Отметка «сделано» для шага урока. Повторное нажатие снимает отметку. */
export function StepToggle({
  lessonId,
  step,
  done,
  label = "Отметить выполненным",
}: {
  lessonId: string;
  step: string;
  done: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<StepActionResult | null, FormData>(toggleLessonStep, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={done}
        className={buttonClass(done ? "secondary" : "sun", "sm")}
        title={done ? "Нажмите, чтобы снять отметку" : undefined}
      >
        {done && <Check aria-hidden="true" className="size-4 text-violet" />}
        {pending ? "Секунду…" : done ? "Сделано" : label}
      </button>
      {state && !state.ok && <span className="text-sm text-coral-deep">{platformErrorMessage(state.error)}</span>}
    </form>
  );
}
