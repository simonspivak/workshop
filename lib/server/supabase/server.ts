import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig } from "@/lib/server/env";
import { sessionCookieOptions } from "./session-cookies";
import type { Database } from "./types";

/**
 * Клиент Supabase от имени вошедшего пользователя (publishable key + cookie сессии).
 * Все запросы проходят через RLS. Создавать заново на каждый запрос.
 *
 * В Server Components cookie менять нельзя — тогда запись молча пропускается:
 * сессию обновляет proxy.ts. В Server Actions и Route Handlers запись работает.
 *
 * Удалять cookie сессии здесь можно только с allowSignOut (вход и выход в login/actions.ts).
 * Остальные запросы их не удаляют: если обновление токена получило 429 или 5xx, auth-js
 * считает сессию мёртвой и стёр бы cookie посреди урока. Мёртвую сессию (например, после
 * смены пароля) удаляет proxy.ts — он отличает временный сбой Supabase Auth от настоящего отказа.
 */
export async function createClient(options: { allowSignOut?: boolean } = {}) {
  const { url, publishableKey } = supabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // одни удаления (value "", maxAge 0) — это выход; без allowSignOut его не пишем
        if (!options.allowSignOut && cookiesToSet.every(({ value }) => value === "")) return;
        try {
          for (const { name, value, options: cookieOptions } of cookiesToSet) {
            cookieStore.set(name, value, cookieOptions);
          }
        } catch {
          // Вызов из Server Component: cookie обновит proxy.ts на следующем запросе
        }
      },
    },
  });
}

export type UserClient = Awaited<ReturnType<typeof createClient>>;
