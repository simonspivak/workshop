"use client";

import { useActionState, useState } from "react";
import { grantGroupStars, type GroupGrantResult } from "../../actions";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";

type Mode = "add" | "top_up_to";

function newKey(): string {
  return crypto.randomUUID();
}

const ru = (n: number) => n.toLocaleString("ru-RU");

/**
 * «Начислить всем по N ★» (аудит № 27). Сначала подтверждение с итогом, потом одна отправка.
 * Ключ формы: повторная отправка того же подтверждения ничего не начислит; после успеха — новый ключ.
 * Лимиты ведущего проверяет сервер (grant_limit) — при отказе не начисляется никому.
 */
export function GroupGrantForm({ groupId, activeStudents }: { groupId: string; activeStudents: number }) {
  const [key, setKey] = useState(newKey);
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState<GroupGrantResult | null, FormData>(async (prev, formData) => {
    const result = await grantGroupStars(prev, formData);
    setConfirming(false);
    if (result.ok) {
      setKey(newKey());
      setAmount("");
      setNote("");
    }
    return result;
  }, null);

  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 10000 && (mode === "add" || n > 0);
  const summary =
    mode === "add"
      ? n > 0
        ? `Каждому из ${activeStudents} учеников +${ru(n)} ★, всего ${ru(n * activeStudents)} ★.`
        : `У каждого из ${activeStudents} учеников снять ${ru(-n)} ★ (у кого меньше — до нуля).`
      : `Каждому из ${activeStudents} учеников довести баланс до ${ru(n)} ★. У кого больше — без изменений.`;

  if (activeStudents === 0) {
    return <p className="text-sm text-ink-soft">Начислять пока некому: в группе нет активных учеников.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="mode" value={mode} />
      {/* на шаге подтверждения поля только для чтения: disabled-поля форма не отправила бы */}
      <fieldset className="space-y-3">
        <legend className={labelClass}>Всем ученикам группы</legend>
        <div role="radiogroup" aria-label="Как начислить" className="flex flex-wrap gap-2">
          {(
            [
              ["add", "+N каждому"],
              ["top_up_to", "до N каждому"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={confirming}
              onClick={() => setMode(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition-colors ${
                mode === value ? "bg-violet text-white ring-violet" : "bg-white text-ink ring-ink/15 hover:bg-lavender"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="group-grant-amount" className="sr-only">
            Сколько звёзд
          </label>
          <input
            id="group-grant-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            required
            min={mode === "add" ? -10000 : 1}
            max={10000}
            placeholder={mode === "add" ? "50" : "100"}
            value={amount}
            readOnly={confirming}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <p className={hintClass}>
            {mode === "add" ? "Минус — снять, но не ниже нуля." : "Добавим только тем, у кого меньше."} Отключённых
            пропустим.
          </p>
          <FieldError state={state} name="amount" />
        </div>
        <div>
          <label htmlFor="group-grant-note" className="sr-only">
            За что
          </label>
          <input
            id="group-grant-note"
            name="note"
            maxLength={200}
            placeholder="За что (необязательно)"
            value={note}
            readOnly={confirming}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </div>
      </fieldset>
      <FormError state={state} />
      {state?.ok && (
        <Notice tone="success">
          {state.already
            ? "Это начисление уже сделано, повтор ничего не изменил."
            : state.affected === 0
              ? "Никому не понадобилось: у всех уже так."
              : `Готово. Учеников: ${state.affected}, всего ${state.total > 0 ? "+" : ""}${ru(state.total)} ★.${state.skipped ? ` Без изменений: ${state.skipped}.` : ""}`}
        </Notice>
      )}
      {confirming ? (
        <div className="space-y-2 rounded-2xl bg-sun/30 p-3">
          <p className="text-sm font-semibold">{summary}</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingText="Начисляем…">
              Да, начислить
            </SubmitButton>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("secondary", "sm")}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!valid} onClick={() => setConfirming(true)} className={buttonClass("secondary", "sm")}>
          Начислить всем
        </button>
      )}
    </form>
  );
}
