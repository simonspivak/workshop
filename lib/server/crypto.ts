import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { botTokenKey } from "@/lib/server/env";

/*
  Шифрование токенов Telegram-ботов (AES-256-GCM, ключ BOT_TOKEN_KEY) и хеши секретов.
  В базе: bots.telegram_token_ciphertext / _iv / _tag (base64). Токен в браузер не возвращается.
  Секрет вебхука (заголовок X-Telegram-Bot-Api-Secret-Token) хранится только как sha256.
*/

export type EncryptedSecret = { ciphertext: string; iv: string; tag: string };

export function encryptSecret(plain: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", botTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", botTokenKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Случайный секрет (base64url), например secret_token вебхука Telegram (1–256 символов A-Za-z0-9_-). */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Сравнить секрет с сохранённым sha256-хешем за постоянное время. */
export function matchesHash(value: string, expectedHex: string): boolean {
  const actual = Buffer.from(sha256Hex(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
