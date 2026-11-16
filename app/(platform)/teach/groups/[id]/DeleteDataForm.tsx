"use client";

import { useActionState, useState } from "react";
import { deleteStudentDataAction, type DeleteStudentDataResult } from "../../student-data";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { buttonClass, inputClass, labelClass } from "@/components/platform/ui";

/**
 * «Удалить данные ученика» — только у админа (аудит № 23). Два шага: кнопка открывает
 * подтверждение, удаление идёт, только если вписан логин ученика. Отменить нельзя.
 */
export function DeleteDataForm({ studentId, confirmText }: { studentId: string; confirmText: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<DeleteStudentDataResult | null, FormData>(deleteStudentDataAction, null);

  return (
    <div className="mt-4 rounded-2xl p-4 ring-1 ring-coral-deep/30">
      <h3 className="font-semibold">Удалить данные ученика</h3>
      <p className="mt-1 text-sm text-ink-soft">
        По просьбе ученика или родителей. Удалится всё: аккаунт и вход, работы и их файлы, домашки, тесты, звёзды,
        бот с перепиской и заявками. Вернуть нельзя. В журнале останется только запись «данные удалены» без имени.
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("danger", "sm")} mt-3`}>
          Удалить данные…
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="studentId" value={studentId} />
          <div>
            <label htmlFor={`confirm-${studentId}`} className={labelClass}>
              Впишите логин <span className="font-mono">{confirmText}</span>, чтобы подтвердить
            </label>
            <input
              id={`confirm-${studentId}`}
              name="confirm"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
              className={`${inputClass} mt-2 font-mono`}
            />
            <FieldError state={state} name="confirm" />
          </div>
          <FormError state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Удаляем…">
              Удалить навсегда
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "sm")}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
