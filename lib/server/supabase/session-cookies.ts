import "server-only";
import type { CookieOptions } from "@supabase/ssr";
import { isDevelopment } from "@/lib/server/env";

/*
  Cookie сессии Supabase (sb-*) — общие настройки для proxy.ts и lib/server/supabase/server.ts.
  Браузерного клиента Supabase у платформы нет: вход, обновление и выход идут на сервере,
  поэтому httpOnly ничего не ломает, а скрипт на странице (даже при XSS) токен не прочитает.
  Secure — везде, кроме `next dev` по http (иначе браузер не сохранит cookie и вход «не держится»).
  name и domain не задаём: @supabase/ssr сам удаляет name, а domain меняет удаление кусков cookie.
  Старые cookie без флагов заменятся при следующем обновлении токена или входе.
*/
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: !isDevelopment(), sameSite: "lax", path: "/" };
}

/**
 * Ошибка обновления сессии, которая не значит «сессия умерла»: 429 (лимит Supabase Auth на IP
 * сервера), 5xx и обрыв сети (AuthRetryableFetchError, status 0). При ней cookie не удаляем —
 * refresh-токен на сервере не потрачен, следующий запрос попробует снова.
 */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, name } = error as { status?: unknown; name?: unknown };
  if (name === "AuthRetryableFetchError") return true;
  return typeof status === "number" && (status === 429 || status >= 500);
}
