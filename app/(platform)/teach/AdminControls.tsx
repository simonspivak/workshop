"use client";

import { useActionState } from "react";
import { setGenerationEnabled, updateStaffLimits } from "./actions";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import type { ActionResult } from "@/lib/platform/messages";

export type StaffLimitsValue = {
  staff_daily_credits: number | null;
  teacher_grant_max: number | null;
  teacher_grant_daily: number | null;
};

/** «Стоп генераций»: выключает все генерации и ответы ботов на платформе (монтаж в браузере работает). */
export function GenerationSwitch({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(setGenerationEnabled, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      {enabled ? (
        <p className="text-ink-soft">
          Сразу останавливает все генерации и ответы ботов у всех: учеников, ведущих и админа. Звёзды не сгорают.
        </p>
      ) : (
        <Notice tone="warn">Генерации выключены на всей платформе. Ученики видят «Генерации временно выключены».</Notice>
      )}
      <FormError state={state} />
      <SubmitButton variant={enabled ? "danger" : "primary"} pendingText="Секунду…">
        {enabled ? "Стоп генераций" : "Включить генерации"}
      </SubmitButton>
    </form>
  );
}

const fields: { name: keyof StaffLimitsValue; label: string; hint: string }[] = [
  {
    name: "staff_daily_credits",
    label: "Кредитов kie в день",
    hint: "На каждый аккаунт ведущего и админа. 3000 ≈ $15 ≈ 20 клипов Seedance 2.5 по 5 с.",
  },
  { name: "teacher_grant_max", label: "★ за одно начисление", hint: "Ведущему. Админ может больше." },
  { name: "teacher_grant_daily", label: "★ начислений в день", hint: "Снятие звёзд не считается." },
];

export function StaffLimitsForm({ limits }: { limits: StaffLimitsValue }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(updateStaffLimits, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className={`${labelClass} block sm:min-h-12`}>
            {field.label}
          </label>
          <input
            id={field.name}
            name={field.name}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={limits[field.name] ?? ""}
            placeholder="без лимита"
            className={`${inputClass} mt-2`}
          />
          <p className={hintClass}>{field.hint}</p>
          <FieldError state={state} name={field.name} />
        </div>
      ))}
      <div className="space-y-3 sm:col-span-3">
        <p className={hintClass}>Пустое поле — без лимита. Действует сразу.</p>
        <FormError state={state} />
        {state?.ok && <Notice tone="success">Сохранено.</Notice>}
        <SubmitButton>Сохранить</SubmitButton>
      </div>
    </form>
  );
}
