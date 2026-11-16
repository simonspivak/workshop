"use client";

import { useActionState, useState } from "react";
import {
  grantStudentStars,
  resetStudentPassword,
  setStudentDisabled,
  updateStudentAge,
  type GrantResult,
  type ResetPasswordResult,
} from "../../actions";
import { FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Badge, Notice, Stars, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { UnlockLoginButton } from "./UnlockLoginButton";
import { ageBandLabels, type ActionResult, type AgeBand } from "@/lib/platform/messages";
import {
  countStudents,
  filterStudents,
  sortStudents,
  type StudentFilter,
  type StudentSort,
} from "@/lib/platform/teacher-cabinet";

export type StudentItem = {
  id: string;
  login: string | null;
  nickname: string;
  ageBand: AgeBand;
  consent: boolean;
  disabled: boolean;
  balance: number;
};

const sortLabels: Record<StudentSort, string> = {
  balance: "по балансу",
  login: "по логину",
  nickname: "по нику",
};

/**
 * lowThreshold — сколько стоит самое дешёвое видео: у кого меньше, тот «на исходе».
 * Порядок и фильтр — в браузере; строки держат ключ id, поэтому обновление страницы
 * не закрывает раскрытого ученика и не стирает набранное в формах.
 */
export function StudentList({ students, lowThreshold }: { students: StudentItem[]; lowThreshold: number }) {
  const [sort, setSort] = useState<StudentSort>("balance");
  const [filter, setFilter] = useState<StudentFilter>("all");

  if (students.length === 0) {
    return <p className="text-ink-soft">Учеников пока нет. Добавьте их пачкой выше.</p>;
  }

  const counts = countStudents(students, lowThreshold);
  const filters: { value: StudentFilter; label: string }[] = [
    { value: "all", label: `Все · ${counts.all}` },
    { value: "zero", label: `0 ★ · ${counts.zero}` },
    { value: "low", label: `Меньше ${lowThreshold} ★ · ${counts.low}` },
    ...(counts.disabled > 0 ? [{ value: "disabled" as const, label: `Отключены · ${counts.disabled}` }] : []),
  ];
  const visible = sortStudents(filterStudents(students, filter, lowThreshold), sort);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Показать" className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1.5 font-mono text-xs font-medium ring-1 transition-colors ${
                filter === f.value ? "bg-violet text-white ring-violet" : "bg-white text-ink ring-ink/15 hover:bg-lavender"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Порядок
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as StudentSort)}
            className="min-h-10 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink"
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="mt-4 text-ink-soft">Таких учеников нет.</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/10">
          {visible.map((student) => (
            <StudentRow key={student.id} student={student} lowThreshold={lowThreshold} />
          ))}
        </ul>
      )}
    </>
  );
}

function StudentRow({ student, lowThreshold }: { student: StudentItem; lowThreshold: number }) {
  const low = !student.disabled && student.balance < lowThreshold;
  return (
    <li className={`py-3 ${student.disabled ? "opacity-70" : ""}`}>
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
            {low && <Badge tone={student.balance <= 0 ? "warn" : "sun"}>{student.balance <= 0 ? "нет звёзд" : "мало звёзд"}</Badge>}
            <span className="font-mono text-sm font-semibold">
              <Stars value={student.balance} />
            </span>
            <span className="ml-auto pl-2 text-sm font-semibold text-violet group-open:hidden">Действия</span>
            <span className="ml-auto hidden pl-2 text-sm font-semibold text-violet group-open:inline">Свернуть</span>
          </span>
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <GrantForm studentId={student.id} />
          <AgeForm student={student} />
          <div className="space-y-4">
            <ResetForm studentId={student.id} />
            {student.login && <UnlockLoginButton studentId={student.id} />}
          </div>
          <DisableForm student={student} />
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
      <SubmitButton size="sm">Начислить / снять</SubmitButton>
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

/** Отключить или включить ученика — с подтверждением, кнопка рядом с остальными действиями. */
function DisableForm({ student }: { student: StudentItem }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await setStudentDisabled(prev, formData);
    if (result.ok) setConfirming(false);
    return result;
  }, null);

  return (
    <form action={action} className="space-y-3 rounded-2xl bg-lavender p-4">
      <h3 className="font-semibold">Доступ</h3>
      <input type="hidden" name="studentId" value={student.id} />
      <input type="hidden" name="disabled" value={student.disabled ? "0" : "1"} />
      {student.disabled ? (
        <p className="text-sm text-ink-soft">Аккаунт отключён: ученик не может войти. Звёзды и работы сохранены.</p>
      ) : (
        <p className="text-sm text-ink-soft">
          Отключённый ученик сразу выйдет из кабинета на всех устройствах и не сможет войти. Звёзды и работы сохранятся.
        </p>
      )}
      <FormError state={state} />
      {student.disabled ? (
        <SubmitButton size="sm" variant="secondary" pendingText="Включаем…">
          Включить
        </SubmitButton>
      ) : confirming ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Отключить {student.login ?? student.nickname}?</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Отключаем…">
              Да, отключить
            </SubmitButton>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("secondary", "sm")}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={buttonClass("danger", "sm")}>
          Отключить
        </button>
      )}
    </form>
  );
}
