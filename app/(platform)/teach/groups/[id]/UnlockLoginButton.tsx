"use client";

import { useActionState } from "react";
import { unlockStudentLogin } from "../../login-unlock";
import { FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice } from "@/components/platform/ui";
import type { ActionResult } from "@/lib/platform/messages";

/** «Снять блокировку входа»: ученик ввёл неверный пароль много раз (или кто-то за него) — пароль прежний. */
export function UnlockLoginButton({ studentId }: { studentId: string }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(unlockStudentLogin, null);
  return (
    <form action={action} className="space-y-3 rounded-2xl bg-lavender p-4">
      <h3 className="font-semibold">Вход</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-ink-soft">
        Пишет «Слишком много попыток»? Снимите блокировку — пароль останется прежним.
      </p>
      <FormError state={state} />
      {state?.ok && <Notice tone="success">Готово. Можно входить.</Notice>}
      <SubmitButton size="sm" variant="secondary" pendingText="Снимаем…">
        Снять блокировку входа
      </SubmitButton>
    </form>
  );
}
