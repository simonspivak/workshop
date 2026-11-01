import { errorMessage, type ActionResult } from "@/lib/platform/messages";
import { Notice } from "@/components/platform/ui";

/** Ошибка Server Action понятным текстом. Ничего не показывает, если ошибки нет. */
export function FormError({ state }: { state: ActionResult<object> | null | undefined }) {
  if (!state || state.ok) return null;
  return <Notice tone="error">{errorMessage(state.error)}</Notice>;
}

/** Ошибка конкретного поля (из zod). */
export function FieldError({ state, name }: { state: ActionResult<object> | null | undefined; name: string }) {
  if (!state || state.ok || !state.fields?.[name]) return null;
  return <p className="mt-1 text-sm text-coral-deep">{state.fields[name]}</p>;
}
