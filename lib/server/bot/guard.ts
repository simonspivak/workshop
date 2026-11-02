import "server-only";
import { moderateText, type ModerationReason } from "@/lib/server/moderation";

/*
  Модерация текстов бота поверх общей (lib/server/moderation.ts):
    • стоп-слова — всегда отказ;
    • номер карты и адрес — всегда отказ;
    • телефон и e-mail — можно только у ботов взрослых владельцев и ведущих (поле «Контакт»
      в заявке). У ботов 14–17 такие сообщения не сохраняются и не уходят в модель.
*/

export type GuardResult = { ok: true } | { ok: false; reason: ModerationReason };

const DIGIT_RUN_RE = /\d[\d\s()-]{11,24}\d/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(DIGIT_RUN_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

export function guardText(text: string, options: { allowContacts: boolean; maxLength: number }): GuardResult {
  const result = moderateText(text, { maxLength: options.maxLength });
  if (result.ok) return result;
  if (options.allowContacts && (result.reason === "phone" || result.reason === "email")) {
    // общая проверка останавливается на первой находке: карту ищем отдельно
    return hasCardNumber(text) ? { ok: false, reason: "card" } : { ok: true };
  }
  return result;
}

/**
 * Ответ бота: стоп-слова — всегда нейтральный ответ. Личные данные в ответе — только у ботов
 * младших (у взрослых в ответе бывает адрес вечера из «Моего текста» или контакт из заявки).
 */
export function guardReply(text: string, options: { adult: boolean }): boolean {
  const result = moderateText(text, { maxLength: 20_000 });
  if (result.ok) return true;
  if (result.reason === "stop_word") return false;
  return options.adult;
}

/**
 * Текст владельца (имя, душа, «Мой текст», подписи формы). Стоп-слова и номера карт — отказ всегда.
 * Телефон, e-mail и адрес — только у младших: у взрослых организаторов в «Моём тексте» бывает
 * адрес вечера и публичный контакт центра.
 */
export function guardOwnerText(text: string, options: { adult: boolean; maxLength: number }): GuardResult {
  const result = moderateText(text, { maxLength: options.maxLength });
  if (result.ok || !options.adult) return result;
  if (result.reason === "stop_word" || result.reason === "too_long" || result.reason === "card") return result;
  return hasCardNumber(text) ? { ok: false, reason: "card" } : { ok: true };
}

/** Есть ли в значении личные данные (для заявок ботов младших). */
export function hasPersonalData(text: string): boolean {
  const result = moderateText(text, { maxLength: 10_000 });
  return !result.ok && result.reason !== "stop_word" && result.reason !== "too_long";
}

/** Что сказать гостю, если сообщение не прошло проверку. */
export function guestBlockedText(reason: ModerationReason): string {
  switch (reason) {
    case "stop_word":
      return "Давайте без таких слов. Попробуйте сказать иначе.";
    case "too_long":
      return "Слишком длинное сообщение. Попробуйте короче.";
    case "card":
      return "Не пишите сюда номер карты: он здесь не нужен.";
    default:
      return "Здесь не нужны телефон, e-mail и адрес. Давайте без личных данных.";
  }
}
