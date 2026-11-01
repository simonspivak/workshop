import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig } from "@/lib/server/env";
import type { Database } from "./types";

/**
 * Клиент Supabase от имени вошедшего пользователя (publishable key + cookie сессии).
 * Все запросы проходят через RLS. Создавать заново на каждый запрос.
 *
 * В Server Components cookie менять нельзя — тогда запись молча пропускается:
 * сессию обновляет proxy.ts. В Server Actions и Route Handlers запись работает.
 */
export async function createClient() {
  const { url, publishableKey } = supabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Вызов из Server Component: cookie обновит proxy.ts на следующем запросе
        }
      },
    },
  });
}

export type UserClient = Awaited<ReturnType<typeof createClient>>;
