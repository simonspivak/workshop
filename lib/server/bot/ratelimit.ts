import "server-only";
import { createHmac } from "node:crypto";
import { BOT_LIMITS } from "@/lib/server/bot/limits";

/*
  Лимиты сообщений гостей (docs/platform/spec.md §5):
    • 30 сообщений в час с одного IP (веб) или из одного чата (Telegram) — на все боты;
    • 200 сообщений гостей в сутки на бота.
  Счётчики — по таблице bot_messages (индексы bot_messages_ip_idx и bot_messages_bot_day_idx).
  Окончательная проверка — в SQL при записи сообщения (insert_bot_message, под блокировкой),
  rateLimitDecision здесь — быстрый отказ до неё. IPv6 считается по сети /64 (ipRateLimitKey).
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

/**
 * Что считать «одним отправителем» для лимитов. IPv4 — адрес целиком. IPv6 — сеть /64:
 * абоненту обычно выдают целую /64, и иначе лимит обходится сменой адреса внутри неё.
 * IPv4 внутри IPv6 (::ffff:1.2.3.4) — как IPv4.
 */
export function ipRateLimitKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip.toLowerCase();
}

function expandIpv6(ip: string): string[] | null {
  let value = ip.toLowerCase();
  // хвост в виде IPv4: 64:ff9b::1.2.3.4
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    value = `${value.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}
