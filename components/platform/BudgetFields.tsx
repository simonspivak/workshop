"use client";

import { useState } from "react";
import { FieldError } from "@/components/platform/FormError";
import { hintClass, inputClass, labelClass } from "@/components/platform/ui";
import type { ActionResult } from "@/lib/platform/messages";

type Initial = { budget: number | null; planned: number | null; perStudent: number | null };

/** Бюджет группы на курс: всего звёзд, сколько учеников, сколько каждому (считается само). */
export function BudgetFields({ state, initial }: { state: ActionResult | null; initial?: Initial }) {
  const [budget, setBudget] = useState(initial?.budget?.toString() ?? "");
  const [planned, setPlanned] = useState(initial?.planned?.toString() ?? "");
  const [perStudent, setPerStudent] = useState(initial?.perStudent?.toString() ?? "");
  const [manual, setManual] = useState(false);

  function recalc(nextBudget: string, nextPlanned: string) {
    if (manual) return;
    const b = Number(nextBudget);
    const p = Number(nextPlanned);
    if (b > 0 && p > 0) setPerStudent(String(Math.floor(b / p)));
  }

  return (
    <>
      <div>
        <label htmlFor="budgetStars" className={labelClass}>
          Бюджет группы на курс, ★
        </label>
        <input
          id="budgetStars"
          name="budgetStars"
          type="number"
          inputMode="numeric"
          min={0}
          max={100000000}
          required
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
            recalc(e.target.value, planned);
          }}
          className={`${inputClass} mt-2 font-mono`}
        />
        <FieldError state={state} name="budgetStars" />
      </div>
      <div>
        <label htmlFor="plannedStudents" className={labelClass}>
          Сколько учеников
        </label>
        <input
          id="plannedStudents"
          name="plannedStudents"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          required
          value={planned}
          onChange={(e) => {
            setPlanned(e.target.value);
            recalc(budget, e.target.value);
          }}
          className={`${inputClass} mt-2 font-mono`}
        />
        <FieldError state={state} name="plannedStudents" />
      </div>
      <div>
        <label htmlFor="starsPerStudent" className={labelClass}>
          Каждому ученику, ★
        </label>
        <input
          id="starsPerStudent"
          name="starsPerStudent"
          type="number"
          inputMode="numeric"
          min={0}
          max={1000000}
          required
          value={perStudent}
          onChange={(e) => {
            setManual(true);
            setPerStudent(e.target.value);
          }}
          className={`${inputClass} mt-2 font-mono`}
        />
        <p className={hintClass}>
          Считается само: бюджет ÷ ученики. Можно поправить. Получают новые ученики группы; уже созданным —
          кнопкой «Начислить».
        </p>
        <FieldError state={state} name="starsPerStudent" />
      </div>
    </>
  );
}
