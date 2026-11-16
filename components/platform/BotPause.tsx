"use client";

import { useActionState } from "react";
import type { BotActionResult } from "@/lib/server/bot/errors";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass } from "@/components/platform/ui";

type Action = (prev: BotActionResult | null, formData: FormData) => Promise<BotActionResult>;

/*
  Пауза бота владельцем. На паузе гости (страница и Telegram) получают короткий ответ
  «бот на паузе»: модель не вызывается, звёзды не тратятся. Проверка в конструкторе работает.
*/
export function BotPause({ paused, action }: { paused: boolean; action: Action }) {
  const [state, submit] = useActionState<BotActionResult | null, FormData>(action, null);
  return (
    <form action={submit} className="space-y-3">
      {state && !state.ok && <Notice tone="error">{state.message}</Notice>}
      <p className={paused ? "font-semibold text-coral-deep" : "text-ink-soft"}>
        {paused
          ? "Бот на паузе: гости видят «бот на паузе», звёзды не тратятся."
          : "Бот отвечает гостям на странице и в Telegram. Каждый ответ — с ваших звёзд."}
      </p>
      <SubmitButton
        name="paused"
        value={paused ? "false" : "true"}
        variant={paused ? "primary" : "secondary"}
        size="sm"
        pendingText={paused ? "Включаем…" : "Ставим на паузу…"}
      >
        {paused ? "Снять с паузы" : "Поставить бота на паузу"}
      </SubmitButton>
      <p className={hintClass}>Проверка в конструкторе работает и на паузе. Telegram остаётся подключённым.</p>
    </form>
  );
}
