import "server-only";
import type { SessionUser } from "@/lib/server/dal/auth";
import { createClient } from "@/lib/server/supabase/server";
import type { LedgerReason } from "@/lib/server/supabase/types";

export type LedgerEntry = { id: number; delta: number; reason: LedgerReason; note: string | null; createdAt: string };

export type StudentHome = { balance: number; recent: LedgerEntry[] };

/** Баланс и последние операции со звёздами текущего пользователя (через RLS). */
export async function getStudentHome(user: SessionUser): Promise<StudentHome> {
  const supabase = await createClient();
  const [wallet, ledger] = await Promise.all([
    supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("star_ledger")
      .select("id, delta, reason, note, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  if (wallet.error) throw new Error(`student.home wallet failed (${wallet.error.code})`);
  if (ledger.error) throw new Error(`student.home ledger failed (${ledger.error.code})`);
  return {
    balance: wallet.data?.balance ?? 0,
    recent: (ledger.data ?? []).map((row) => ({
      id: row.id,
      delta: row.delta,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at,
    })),
  };
}

/** Только баланс — для шапки. */
export async function getMyBalance(user: SessionUser): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
  if (error) return 0;
  return data?.balance ?? 0;
}
