/** Только свои пути кабинета: защита от open redirect через ?next=. Общая для входа и для /login у вошедшего. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return /^\/(app|teach)(\/|\?|$)/.test(next) ? next : null;
}
