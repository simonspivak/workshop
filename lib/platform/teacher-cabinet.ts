// Чистая логика кабинета ведущего: порядок и фильтры списка учеников, карточки нескольких пачек,
// предупреждения бюджета. Без сервера и секретов — можно импортировать в клиентские компоненты.

// ---------- список учеников (аудит № 30) ----------

export type StudentSort = "balance" | "login" | "nickname";
export type StudentFilter = "all" | "zero" | "low" | "disabled";

type SortableStudent = { login: string | null; nickname: string; balance: number; disabled: boolean };

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/** Новый массив: по балансу — сначала у кого меньше звёзд, при равенстве — по логину. */
export function sortStudents<T extends SortableStudent>(students: readonly T[], sort: StudentSort): T[] {
  const byLogin = (a: T, b: T) => collator.compare(a.login ?? "", b.login ?? "") || collator.compare(a.nickname, b.nickname);
  const copy = [...students];
  if (sort === "balance") return copy.sort((a, b) => a.balance - b.balance || byLogin(a, b));
  if (sort === "nickname") return copy.sort((a, b) => collator.compare(a.nickname, b.nickname) || byLogin(a, b));
  return copy.sort(byLogin);
}

/** low — меньше lowThreshold звёзд, но не ноль. Отключённые попадают только в «отключены» и «все». */
export function filterStudents<T extends SortableStudent>(
  students: readonly T[],
  filter: StudentFilter,
  lowThreshold: number,
): T[] {
  switch (filter) {
    case "zero":
      return students.filter((s) => !s.disabled && s.balance <= 0);
    case "low":
      return students.filter((s) => !s.disabled && s.balance > 0 && s.balance < lowThreshold);
    case "disabled":
      return students.filter((s) => s.disabled);
    default:
      return [...students];
  }
}

export function countStudents(students: readonly SortableStudent[], lowThreshold: number): Record<StudentFilter, number> {
  return {
    all: students.length,
    zero: filterStudents(students, "zero", lowThreshold).length,
    low: filterStudents(students, "low", lowThreshold).length,
    disabled: filterStudents(students, "disabled", lowThreshold).length,
  };
}

// ---------- несколько пачек учеников (аудит № 29) ----------

type CreatedLike = { login: string };
type BatchResult<C extends CreatedLike, E> = ({ ok: true; created: C[]; failed: string[] }) | ({ ok: false } & E);

/** Что показывает страница после нескольких отправок формы «Добавить учеников». */
export type CreatedSession<C extends CreatedLike, E> = {
  /** все ученики, созданные на этой странице, по порядку пачек */
  created: C[];
  /** не созданные в последней удачной пачке */
  failed: string[];
  batches: number;
  /** ошибка последней отправки (прошлые карточки при этом остаются) */
  error: ({ ok: false } & E) | null;
};

/** Добавить результат очередной пачки: карточки прошлых пачек не пропадают. */
export function mergeCreatedBatch<C extends CreatedLike, E>(
  prev: CreatedSession<C, E> | null,
  result: BatchResult<C, E>,
): CreatedSession<C, E> {
  const base: CreatedSession<C, E> = prev ?? { created: [], failed: [], batches: 0, error: null };
  if (!result.ok) return { ...base, error: result };
  const fresh = new Set(result.created.map((s) => s.login));
  return {
    created: [...base.created.filter((s) => !fresh.has(s.login)), ...result.created],
    failed: result.failed,
    batches: base.batches + 1,
    error: null,
  };
}

// ---------- бюджет группы (аудит № 51) ----------

export type BudgetInput = {
  budgetStars: number | null;
  plannedStudents: number | null;
  starsPerStudent: number | null;
  /** ученики без отключённых */
  activeStudents: number;
  /** стартовые звёзды и начисления ведущего минус снятия, без бонусов тестов */
  handed: number;
};

const ru = (n: number) => n.toLocaleString("ru-RU");

/** Короткие предупреждения для карточки «Звёзды группы». Пустой массив — всё в порядке. */
export function budgetWarnings(input: BudgetInput): string[] {
  const warnings: string[] = [];
  if (input.plannedStudents != null && input.activeStudents > input.plannedStudents) {
    warnings.push(`Учеников больше плана: ${input.activeStudents} из ${input.plannedStudents}.`);
  }
  if (input.budgetStars != null) {
    if (input.handed > input.budgetStars) {
      warnings.push(`Роздано больше бюджета: ${ru(input.handed)} из ${ru(input.budgetStars)} ★.`);
    } else if (input.starsPerStudent != null) {
      const planned = input.activeStudents * input.starsPerStudent;
      if (planned > input.budgetStars) {
        warnings.push(`По ${ru(input.starsPerStudent)} ★ каждому выйдет ${ru(planned)} ★ — больше бюджета ${ru(input.budgetStars)} ★.`);
      }
    }
  }
  return warnings;
}
