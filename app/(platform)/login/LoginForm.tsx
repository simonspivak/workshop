"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action] = useActionState<LoginState, FormData>(login, null);

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="login" className={labelClass}>
          Логин или e-mail
        </label>
        <input
          id="login"
          name="login"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="md1-lisa"
          className={`${inputClass} mt-2 font-mono`}
        />
        <p className={hintClass}>Ученики — логин с карточки. Ведущие — свой e-mail.</p>
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${inputClass} mt-2 font-mono`}
        />
      </div>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pendingText="Входим…" className="w-full">
        Войти
      </SubmitButton>
    </form>
  );
}
