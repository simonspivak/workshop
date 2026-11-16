import "server-only";
import { createHmac } from "node:crypto";
import { ConfigError, supabaseSecretConfig } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase/admin";

/*
  Счётчики попыток входа: public.rate_limit_hit / rate_limit_reset (миграция 20261105100000),
  rate_limit_take / rate_limit_refund (20261116150000): попытка с IP занимается до проверки
  пароля и возвращается при успехе — так IP-лимит считает только неудачи.
  Зачем свои: вход идёт через сервер, поэтому Supabase Auth видит IP Vercel, а не ученика,
  и его лимит на перебор паролей общий на всех.
  В базе — только HMAC от назначения и значения (логин, IP); сами значения не храним.
  Ключ HMAC выводится из SUPABASE_SECRET_KEY: он есть везде, где работает admin-клиент.
  Сбой базы вход не закрывает (ошибка — в лог): иначе неудачный деплой запер бы всех.
*/

export type RateLimitRule = { purpose: string; limit: number; windowSec: number };

export const LOGIN_LIMITS = {
  /**
   * попыток на один логин за 15 минут; после удачного входа счётчик сбрасывается.
   * Это и есть защита от перебора пароля: снять её может ведущий (кнопка в кабинете или новый пароль).
   */
  account: { purpose: "login-account", limit: 20, windowSec: 15 * 60 },
  /**
   * НЕУДАЧНЫХ попыток с одного IP (IPv6 — сеть /64) за 15 минут; удачный вход попытку возвращает.
   * Класс из 50 за одним роутером с 2–3 опечатками на человека — 100–150; 300 — двойной запас,
   * а перебор по многим логинам с одного IP — не больше 15 логинов × 20 попыток.
   */
  ip: { purpose: "login-ip", limit: 300, windowSec: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** HMAC от назначения и значения: тот же ключ для счётчиков и для журнала (без открытых IP и логинов). */
export function keyFor(purpose: string, value: string): string {
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

/**
 * Занятая попытка: вернуть её refundAttempt, если она не должна считаться (пароль верный).
 * id = null — счётчик недоступен (сбой базы), вход не закрываем и возвращать нечего.
 */
export type Reservation = { purpose: string; key: string; id: number | null };

/** Занять попытку до проверки. null — лимит исчерпан. */
export async function reserveAttempt(rule: RateLimitRule, value: string): Promise<Reservation | null> {
  try {
    const key = keyFor(rule.purpose, value);
    const { data, error } = await createAdminClient().rpc("rate_limit_take", {
      p_key: key,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSec,
    });
    if (error) {
      console.error("rateLimit.reserve: rpc failed", { purpose: rule.purpose, code: error.code });
      return { purpose: rule.purpose, key, id: null };
    }
    if (data === null || data === undefined) return null;
    return { purpose: rule.purpose, key, id: Number(data) };
  } catch (error) {
    if (!(error instanceof ConfigError)) console.error("rateLimit.reserve: unexpected error", { purpose: rule.purpose });
    return { purpose: rule.purpose, key: "", id: null };
  }
}

/** Вернуть занятую попытку (только её: чужие неудачи с того же ключа остаются). */
export async function refundAttempt(reservation: Reservation): Promise<void> {
  if (reservation.id === null) return;
  try {
    const { error } = await createAdminClient().rpc("rate_limit_refund", {
      p_key: reservation.key,
      p_hit_id: reservation.id,
    });
    if (error) console.error("rateLimit.refund: rpc failed", { purpose: reservation.purpose, code: error.code });
  } catch {
    // попытка просто истечёт через окно
  }
}

/** Сбросить счётчик (после удачного входа или по кнопке ведущего). */
export async function resetAttempts(rule: RateLimitRule, value: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient().rpc("rate_limit_reset", { p_key: keyFor(rule.purpose, value) });
    if (error) console.error("rateLimit.reset: rpc failed", { purpose: rule.purpose, code: error.code });
    return !error;
  } catch {
    // счётчик сам истечёт через окно
    return false;
  }
}
