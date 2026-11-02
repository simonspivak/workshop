"use client";

import { useActionState } from "react";
import type { BotActionResult } from "@/lib/server/bot/errors";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";

/** Первый шаг: только имя. Адрес /b/<имя> платформа подберёт сама. */
export function BotCreateForm({
  action,
  maxLength,
}: {
  action: (prev: BotActionResult | null, formData: FormData) => Promise<BotActionResult>;
  maxLength: number;
}) {
  const [state, formAction] = useActionState<BotActionResult | null, FormData>(action, null);
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <div>
        <label htmlFor="new-bot-name" className={labelClass}>
          Как зовут бота
        </label>
        <input
          id="new-bot-name"
          name="name"
          required
          maxLength={maxLength}
          placeholder="Например: Лёва Латке"
          className={`${inputClass} mt-2`}
        />
        <p className={hintClass}>Обычно это имя вашего героя. Адрес страницы платформа соберёт из имени, потом его можно поменять.</p>
      </div>
      {state && !state.ok && <Notice tone="error">{state.fields?.name ?? state.message}</Notice>}
      <SubmitButton pendingText="Создаём…">Создать бота</SubmitButton>
    </form>
  );
}
