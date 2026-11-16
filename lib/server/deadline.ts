/*
  Общий срок для шагов, которые должны уложиться в жизнь функции Vercel (аудит № 21).
  deadline — момент (Date.now()), после которого шаг не начинается, а начатый обрывается.
*/

/** Шаг короче этого не начинаем: всё равно не успеет. */
export const MIN_STEP_MS = 1_000;

export function msLeft(deadline: number | undefined, now = Date.now()): number {
  return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - now;
}

/** Сигнал, который сработает к сроку (и не позже capMs, если он задан). null — срок уже вышел. */
export function deadlineSignal(deadline: number | undefined, capMs?: number): AbortSignal | null {
  const left = Math.min(msLeft(deadline), capMs ?? Number.POSITIVE_INFINITY);
  if (left === Number.POSITIVE_INFINITY) return new AbortController().signal;
  if (left < MIN_STEP_MS) return null;
  return AbortSignal.timeout(Math.floor(left));
}

/** fetch, который обрывается к сроку (вместе с собственным signal запроса, если он есть). */
export function fetchUntil(deadline: number): typeof fetch {
  return (input, init) => {
    const left = deadline - Date.now();
    const timeout = AbortSignal.timeout(Math.max(0, Math.floor(left)));
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}
