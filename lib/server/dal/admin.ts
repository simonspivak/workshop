import "server-only";
import { getGatewayBalance, isMockMode } from "@/lib/server/gateway";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Json } from "@/lib/server/supabase/types";

/*
  Пульт админа в кабинете /teach: рубильник «Стоп генераций» (settings.generation_enabled),
  потолки ведущих (миграция 20261116120000_staff_caps) и баланс kie.
  Вызывать только после проверки роли admin. Баланс kie спрашиваем у шлюза не чаще раза
  в минуту на инстанс и только со страницы админа — никогда из запросов учеников.
*/

export type StaffLimitKey = "staff_daily_credits" | "teacher_grant_max" | "teacher_grant_daily";
export const STAFF_LIMIT_KEYS: readonly StaffLimitKey[] = ["staff_daily_credits", "teacher_grant_max", "teacher_grant_daily"];

export type KieBalance = { state: "ok"; credits: number | null } | { state: "mock" } | { state: "error" };

export type AdminPanel = {
  generationEnabled: boolean;
  /** null — без лимита */
  limits: Record<StaffLimitKey, number | null>;
  kie: KieBalance;
};

const BALANCE_TTL_MS = 60_000;
let balanceCache: { at: number; value: Promise<KieBalance> } | null = null;

/** Баланс кредитов kie, кеш ~60 с (и общий для одновременных запросов). Ошибку не кешируем надолго. */
export function getKieBalance(): Promise<KieBalance> {
  if (isMockMode()) return Promise.resolve({ state: "mock" });
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value;
  const value = getGatewayBalance()
    .then((res): KieBalance => (res.ok ? { state: "ok", credits: res.credits } : { state: "error" }))
    .catch((): KieBalance => ({ state: "error" }));
  balanceCache = { at: Date.now(), value };
  void value.then((res) => {
    if (res.state === "error" && balanceCache?.value === value) balanceCache = null;
  });
  return value;
}

function numberOrNull(value: Json | undefined): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function getAdminPanel(): Promise<AdminPanel> {
  const [settings, kie] = await Promise.all([
    createAdminClient()
      .from("settings")
      .select("key, value")
      .in("key", ["generation_enabled", ...STAFF_LIMIT_KEYS]),
    getKieBalance(),
  ]);
  if (settings.error) throw new Error(`admin.settings failed (${settings.error.code})`);
  const byKey = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
  const enabled = byKey.get("generation_enabled");
  return {
    // как private.generation_enabled(): нет строки — генерации включены
    generationEnabled: enabled !== false && enabled !== "false",
    limits: {
      staff_daily_credits: numberOrNull(byKey.get("staff_daily_credits")),
      teacher_grant_max: numberOrNull(byKey.get("teacher_grant_max")),
      teacher_grant_daily: numberOrNull(byKey.get("teacher_grant_daily")),
    },
    kie,
  };
}
