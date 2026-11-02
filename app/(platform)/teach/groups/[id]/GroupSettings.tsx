"use client";

import { useActionState } from "react";
import { setGroupPaused, updateGroup } from "../../actions";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { BudgetFields } from "@/components/platform/BudgetFields";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { groupKindLabels, type ActionResult, type GroupKind } from "@/lib/platform/messages";

export type GroupSettingsValue = {
  id: string;
  title: string;
  kind: GroupKind;
  endsOn: string | null;
  budgetStars: number | null;
  plannedStudents: number | null;
  starsPerStudent: number | null;
  allowGoogleMinors: boolean;
  shareGallery: boolean;
  paused: boolean;
};

export function PauseControl({ group }: { group: GroupSettingsValue }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(setGroupPaused, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="paused" value={group.paused ? "0" : "1"} />
      {group.paused ? (
        <Notice tone="warn">Группа на паузе: ученики не могут генерировать, боты учеников молчат.</Notice>
      ) : (
        <p className="text-ink-soft">Пауза сразу останавливает все генерации учеников группы. Звёзды не сгорают.</p>
      )}
      <FormError state={state} />
      <SubmitButton variant={group.paused ? "primary" : "danger"} pendingText="Секунду…">
        {group.paused ? "Снять с паузы" : "Поставить на паузу"}
      </SubmitButton>
    </form>
  );
}

export function GroupSettingsForm({ group }: { group: GroupSettingsValue }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(updateGroup, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <input type="hidden" name="groupId" value={group.id} />
      <div>
        <label htmlFor="title" className={labelClass}>
          Название
        </label>
        <input id="title" name="title" required maxLength={80} defaultValue={group.title} className={`${inputClass} mt-2`} />
        <FieldError state={state} name="title" />
      </div>
      <div>
        <label htmlFor="kind" className={labelClass}>
          Тип
        </label>
        <select id="kind" name="kind" defaultValue={group.kind} className={`${inputClass} mt-2`}>
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
        <input id="endsOn" name="endsOn" type="date" defaultValue={group.endsOn ?? ""} className={`${inputClass} mt-2`} />
        <p className={hintClass}>Боты учеников работают ещё 14 дней после этой даты.</p>
        <FieldError state={state} name="endsOn" />
      </div>
      <BudgetFields state={state} initial={{ budget: group.budgetStars, planned: group.plannedStudents, perStudent: group.starsPerStudent }} />
      <fieldset className="space-y-3 sm:col-span-2">
        <legend className="sr-only">Доступ</legend>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="allowGoogleMinors"
            defaultChecked={group.allowGoogleMinors}
            className="mt-1 size-5 accent-violet"
          />
          <span>
            Модели Google для младше 18
            <span className={`${hintClass} block`}>
              Nano Banana и озвучка Gemini. По условиям Google — только с 18, решение за ведущим.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="shareGallery" defaultChecked={group.shareGallery} className="mt-1 size-5 accent-violet" />
          <span>
            Общая галерея группы
            <span className={`${hintClass} block`}>Ученики видят готовые нескрытые работы одногруппников.</span>
          </span>
        </label>
      </fieldset>
      <div className="space-y-3 sm:col-span-2">
        <FormError state={state} />
        {state?.ok && <Notice tone="success">Сохранено.</Notice>}
        <SubmitButton>Сохранить</SubmitButton>
      </div>
    </form>
  );
}
