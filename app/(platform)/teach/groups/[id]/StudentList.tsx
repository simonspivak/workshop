"use client";

import { useActionState, useState } from "react";
import { grantStudentStars, resetStudentPassword, updateStudentAge, type GrantResult, type ResetPasswordResult } from "../../actions";
import { FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Badge, Notice, Stars, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { ageBandLabels, type ActionResult, type AgeBand } from "@/lib/platform/messages";

export type StudentItem = {
  id: string;
  login: string | null;
  nickname: string;
  ageBand: AgeBand;
  consent: boolean;
  disabled: boolean;
  balance: number;
};

export function StudentList({ students }: { students: StudentItem[] }) {
  if (students.length === 0) {
    return <p className="text-ink-soft">Учеников пока нет. Добавьте их пачкой выше.</p>;
  }
  return (
    <ul className="divide-y divide-ink/10">
      {students.map((student) => (
        <StudentRow key={student.id} student={student} />
      ))}
    </ul>
  );
}

function StudentRow({ student }: { student: StudentItem }) {
  return (
    <li className="py-3">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-2xl py-1 sm:flex-row sm:items-center sm:gap-4 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 sm:flex-1">
            <span className="block truncate font-mono font-semibold">{student.login ?? "—"}</span>
            <span className="block truncate text-sm text-ink-soft">{student.nickname}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{ageBandLabels[student.ageBand]}</Badge>
            {student.ageBand !== "adult" && (student.consent ? <Badge tone="violet">согласие</Badge> : <Badge tone="warn">без согласия</Badge>)}
            {student.disabled && <Badge tone="warn">отключён</Badge>}
            <span className="font-mono text-sm font-semibold">
              <Stars value={student.balance} />
            </span>
            <span className="ml-auto pl-2 text-sm font-semibold text-violet group-open:hidden">Действия</span>
            <span className="ml-auto hidden pl-2 text-sm font-semibold text-violet group-open:inline">Свернуть</span>
          </span>
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <GrantForm studentId={student.id} />
          <AgeForm student={student} />
          <ResetForm studentId={student.id} />
        </div>
      </details>
    </li>
  );
}

function newKey(): string {
  return crypto.randomUUID();
}

function GrantForm({ studentId }: { studentId: string }) {
  // Ключ формы: двойная отправка той же формы не начислит дважды; после успеха — новый ключ
  const [key, setKey] = useState(newKey);
  const [state, action] = useActionState<GrantResult | null, FormData>(async (prev, formData) => {
    const result = await grantStudentStars(prev, formData);
    if (result.ok) setKey(newKey());
    return result;
  }, null);

  return (
    <form action={action} className="space-y-3 rounded-2xl bg-lavender p-4">
      <h3 className="font-semibold">Звёзды</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <div>
        <label htmlFor={`amount-${studentId}`} className={labelClass}>
          Сколько
        </label>
        <input
          id={`amount-${studentId}`}
          name="amount"
          type="number"
          inputMode="numeric"
          required
          min={-10000}
          max={10000}
          placeholder="100"
          className={`${inputClass} mt-2 font-mono`}
        />
        <p className={hintClass}>Минус — снять. Баланс не уйдёт ниже нуля.</p>
      </div>
      <div>
        <label htmlFor={`note-${studentId}`} className={labelClass}>
          За что
        </label>
        <input id={`note-${studentId}`} name="note" maxLength={200} placeholder="За проект" className={`${inputClass} mt-2`} />
      </div>
      <FormError state={state} />
      {state?.ok && <Notice tone="success">Готово. Баланс: {state.balance} ★</Notice>}
      <SubmitButton size="sm">Начислить</SubmitButton>
    </form>
  );
}

function AgeForm({ student }: { student: StudentItem }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(updateStudentAge, null);
  return (
    <form action={action} className="space-y-3 rounded-2xl bg-lavender p-4">
      <h3 className="font-semibold">Возраст и согласие</h3>
      <input type="hidden" name="studentId" value={student.id} />
      <div>
        <label htmlFor={`age-${student.id}`} className={labelClass}>
          Возраст
        </label>
        <select id={`age-${student.id}`} name="ageBand" defaultValue={student.ageBand} className={`${inputClass} mt-2`}>
          {Object.entries(ageBandLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className={hintClass}>Дату рождения не храним. 18+ открывает модели Google, говорящую голову и Telegram.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" defaultChecked={student.consent} className="mt-1 size-5 accent-violet" />
        <span>Согласие родителей получено</span>
      </label>
      <FormError state={state} />
      {state?.ok && <Notice tone="success">Сохранено.</Notice>}
      <SubmitButton size="sm" variant="secondary">
        Сохранить
      </SubmitButton>
    </form>
  );
}

function ResetForm({ studentId }: { studentId: string }) {
  const [state, action] = useActionState<ResetPasswordResult | null, FormData>(resetStudentPassword, null);
  return (
    <form action={action} className="space-y-3 rounded-2xl bg-lavender p-4">
      <h3 className="font-semibold">Пароль</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-ink-soft">Новый пароль покажем один раз. Старый перестанет работать.</p>
      <FormError state={state} />
      {state?.ok && (
        <Notice tone="warn">
          <span className="block">
            Логин: <span className="font-mono font-semibold">{state.login}</span>
          </span>
          <span className="block">
            Пароль: <span className="font-mono font-semibold">{state.password}</span>
          </span>
        </Notice>
      )}
      <SubmitButton size="sm" variant="danger" pendingText="Сбрасываем…">
        Сбросить пароль
      </SubmitButton>
    </form>
  );
}
