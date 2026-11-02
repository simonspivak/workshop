import "server-only";
import { createHmac } from "node:crypto";
import { BOT_LIMITS } from "@/lib/server/bot/limits";

/*
  Лимиты сообщений гостей (docs/platform/spec.md §5):
    • 30 сообщений в час с одного IP (веб) или из одного чата (Telegram) — на все боты;
    • 200 сообщений гостей в сутки на бота.
  Счётчики — по таблице bot_messages (индексы bot_messages_ip_idx и bot_messages_bot_day_idx).
  IP и chat id не храним: только HMAC с ключом, выведенным из BOT_TOKEN_KEY, и датой —
  хеш меняется каждый день, поэтому по нему нельзя проследить гостя дольше суток.
*/

export type RateLimitHit = "sender_hour" | "bot_day";

export function rateLimitDecision(
  counts: { senderLastHour: number | null; botLastDay: number },
  limits: { senderPerHour: number; botPerDay: number } = BOT_LIMITS,
): RateLimitHit | null {
  if (counts.senderLastHour !== null && counts.senderLastHour >= limits.senderPerHour) return "sender_hour";
  if (counts.botLastDay >= limits.botPerDay) return "bot_day";
  return null;
}

/** Хеш отправителя: HMAC-SHA256(key, kind:day:value), hex (64 символа, колонка ip_hash ≤ 128). */
export function senderHash(key: Buffer, kind: "ip" | "tg", value: string, day: string): string {
  return createHmac("sha256", key).update(`${kind}:${day}:${value}`).digest("hex");
}

/**
 * IP клиента. На Vercel x-forwarded-for выставляет платформа (подделанное значение
 * клиента она перезаписывает), x-real-ip — запасной вариант.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "";
  return ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}
