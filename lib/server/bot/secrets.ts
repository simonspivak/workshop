import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { botTokenKey } from "@/lib/server/env";
import { berlinDate } from "@/lib/server/bot/lifetime";
import { senderHash } from "@/lib/server/bot/ratelimit";

/*
  Производные ключи ботов. Отдельной переменной окружения нет: всё выводится из BOT_TOKEN_KEY
  через HMAC с меткой назначения, поэтому ключи разных назначений не совпадают.
    • соль хеша IP и chat id (лимиты, без хранения самих IP);
    • подпись «билета» открытки (гость подтверждает кнопкой, сервер проверяет, что сцену дал бот);
    • код привязки чата владельца в Telegram (deep link /start owner_…).
*/

function derivedKey(purpose: string): Buffer {
  return createHmac("sha256", botTokenKey()).update(`iistart-bot:${purpose}:v1`).digest();
}

/** Хеш IP (веб) или chat id (Telegram) на сегодня. */
export function hashSender(kind: "ip" | "tg", value: string, now = new Date()): string {
  return senderHash(derivedKey("sender"), kind, value, berlinDate(now));
}

/** Постоянный псевдоним чата Telegram для conversation_id (сам chat id не храним). */
export function telegramConversationId(chatId: number): string {
  return `tg:${createHmac("sha256", derivedKey("tg-chat")).update(String(chatId)).digest("base64url").slice(0, 32)}`;
}

// ---------- сессия веб-чата ----------

export const BOT_SESSION_COOKIE = "iis_bot_sid";
const SESSION_RE = /^[A-Za-z0-9_-]{24}$/;

export function newSessionId(): string {
  return randomBytes(18).toString("base64url");
}

export function isSessionId(value: string | undefined | null): value is string {
  return typeof value === "string" && SESSION_RE.test(value);
}

export function webConversationId(sessionId: string): string {
  return `web:${sessionId}`;
}

export function previewConversationId(userId: string): string {
  return `owner:${userId}`;
}

export const PREVIEW_PREFIX = "owner:";

// ---------- билет открытки ----------

type CardTicket = { b: string; c: string; s: string; e: number };

const CARD_TICKET_TTL_MS = 30 * 60_000;

export function signCardTicket(input: { botId: string; conversationId: string; scene: string }, now = Date.now()): string {
  const payload: CardTicket = { b: input.botId, c: input.conversationId, s: input.scene, e: now + CARD_TICKET_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", derivedKey("card")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Сцена из билета, если подпись верна, билет не истёк и выдан этому боту и этому диалогу. */
export function verifyCardTicket(
  ticket: string,
  expected: { botId: string; conversationId: string },
  now = Date.now(),
): string | null {
  if (typeof ticket !== "string" || ticket.length > 2000) return null;
  const [body, mac] = ticket.split(".");
  if (!body || !mac) return null;
  const expectedMac = createHmac("sha256", derivedKey("card")).update(body).digest();
  const actualMac = Buffer.from(mac, "base64url");
  if (actualMac.length !== expectedMac.length || !timingSafeEqual(actualMac, expectedMac)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CardTicket;
    if (payload.b !== expected.botId || payload.c !== expected.conversationId) return null;
    if (typeof payload.e !== "number" || payload.e < now) return null;
    return typeof payload.s === "string" ? payload.s : null;
  } catch {
    return null;
  }
}

// ---------- привязка чата владельца в Telegram ----------

/**
 * Код для ссылки t.me/<бот>?start=owner_<код>: по нему бот узнаёт чат владельца
 * и шлёт туда уведомления о заявках. Меняется при каждом новом подключении токена.
 */
export function ownerLinkCode(botId: string, telegramBotId: number, connectedAt: string): string {
  return createHmac("sha256", derivedKey("owner-link"))
    .update(`${botId}:${telegramBotId}:${connectedAt}`)
    .digest("base64url")
    .slice(0, 24);
}

export function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
