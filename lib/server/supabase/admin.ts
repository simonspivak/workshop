import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretConfig } from "@/lib/server/env";
import type { Database } from "./types";

let client: SupabaseClient<Database> | null = null;

/**
 * Клиент с секретным ключом (роль service_role, обходит RLS).
 * Только после проверки прав в DAL. Без сессии и cookie, поэтому его можно переиспользовать.
 * У service_role нет прав менять wallets и star_ledger напрямую: звёзды — только через
 * функции из lib/server/wallet.ts.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (client) return client;
  const { url, secretKey } = supabaseSecretConfig();
  client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

export type AdminClient = SupabaseClient<Database>;
