import "server-only";
import { createHmac } from "node:crypto";
import { ConfigError, supabaseSecretConfig } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase/admin";

/*
  Счётчики попыток входа: public.rate_limit_hit / rate_limit_reset (миграция 20261105100000).
  Зачем свои: вход идёт через сервер, поэтому Supabase Auth видит IP Vercel, а не ученика,
  и его лимит на перебор паролей общий на всех.
  В базе — только HMAC от назначения и значения (логин, IP); сами значения не храним.
  Ключ HMAC выводится из SUPABASE_SECRET_KEY: он есть везде, где работает admin-клиент.
  Сбой базы вход не закрывает (ошибка — в лог): иначе неудачный деплой запер бы всех.
*/

export type RateLimitRule = { purpose: string; limit: number; windowSec: number };

export const LOGIN_LIMITS = {
  /** попыток на один логин за 15 минут; после удачного входа счётчик сбрасывается */
  account: { purpose: "login-account", limit: 20, windowSec: 15 * 60 },
  /** попыток с одного IP (IPv6 — сеть /64) за 15 минут: с запасом на класс за одним роутером */
  ip: { purpose: "login-ip", limit: 100, windowSec: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

function keyFor(purpose: string, value: string): string {
  const key = createHmac("sha256", supabaseSecretConfig().secretKey).update("iistart:rate-limit:v1").digest();
  return `${purpose}:${createHmac("sha256", key).update(value).digest("base64url")}`;
}

/** Засчитать попытку. false — лимит исчерпан, попытку делать нельзя. */
export async function takeAttempt(rule: RateLimitRule, value: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: keyFor(rule.purpose, value),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSec,
    });
    if (error) {
      console.error("rateLimit.take: rpc failed", { purpose: rule.purpose, code: error.code });
      return true;
    }
    return data !== false;
  } catch (error) {
    if (!(error instanceof ConfigError)) console.error("rateLimit.take: unexpected error", { purpose: rule.purpose });
    return true;
  }
}

/** Сбросить счётчик (после удачного входа). */
export async function resetAttempts(rule: RateLimitRule, value: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("rate_limit_reset", { p_key: keyFor(rule.purpose, value) });
    if (error) console.error("rateLimit.reset: rpc failed", { purpose: rule.purpose, code: error.code });
  } catch {
    // счётчик сам истечёт через окно
  }
}
