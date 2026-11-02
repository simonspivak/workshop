"use client";

import { useActionState } from "react";
import { createGroup } from "./actions";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { BudgetFields } from "@/components/platform/BudgetFields";
import { hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { groupKindLabels, type ActionResult } from "@/lib/platform/messages";

export function CreateGroupForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(createGroup, null);

  return (
    <form action={action} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor="code" className={labelClass}>
          Код группы
        </label>
        <input
          id="code"
          name="code"
          required
          minLength={2}
          maxLength={12}
          pattern="[a-zA-Z0-9]{2,12}"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="md1"
          className={`${inputClass} mt-2 font-mono`}
        />
        <p className={hintClass}>2–12 латинских букв и цифр. Начало логинов: md1-lisa. Потом не меняется.</p>
        <FieldError state={state} name="code" />
      </div>
      <div>
        <label htmlFor="title" className={labelClass}>
          Название
        </label>
        <input id="title" name="title" required maxLength={80} placeholder="Кишинёв, осень" className={`${inputClass} mt-2`} />
        <FieldError state={state} name="title" />
      </div>
      <div>
        <label htmlFor="kind" className={labelClass}>
          Тип
        </label>
        <select id="kind" name="kind" defaultValue="teens" className={`${inputClass} mt-2`}>
          {Object.entries(groupKindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="endsOn" className={labelClass}>
          Последний урок
        </label>
        <input id="endsOn" name="endsOn" type="date" className={`${inputClass} mt-2`} />
        <p className={hintClass}>Боты учеников работают ещё 14 дней после этой даты.</p>
        <FieldError state={state} name="endsOn" />
      </div>
      <BudgetFields state={state} />
      <fieldset className="space-y-3 self-end">
        <legend className="sr-only">Доступ</legend>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="allowGoogleMinors" className="mt-1 size-5 accent-violet" />
          <span>
            Модели Google для младше 18
            <span className={`${hintClass} block`}>Nano Banana и озвучка Gemini. По условиям Google — только с 18.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="shareGallery" className="mt-1 size-5 accent-violet" />
          <span>Общая галерея группы</span>
        </label>
      </fieldset>
      <div className="space-y-3 sm:col-span-2">
        <FormError state={state} />
        <SubmitButton pendingText="Создаём…">Создать группу</SubmitButton>
      </div>
    </form>
  );
}
