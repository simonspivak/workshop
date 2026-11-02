import "server-only";
import { BOT_LIMITS } from "@/lib/server/bot/limits";

/*
  Срок жизни бота (docs/platform/spec.md §5): бот ученика работает до groups.ends_on + 14 дней
  включительно (дата по Берлину). Потом: веб-чат показывает «бот переехал», Telegram-вебхук
  снимается при первом входящем сообщении, конструктор — «Забери бота с собой».
  Боты ведущих и админов не ограничены. Пока у группы нет даты окончания — тоже без срока.
*/

export type BotLifetime = {
  /** срок есть */
  limited: boolean;
  /** последний рабочий день, YYYY-MM-DD; null — без срока */
  lastDay: string | null;
  /** срок вышел */
  retired: boolean;
  /** сколько дней осталось, включая сегодня; null — без срока или уже вышел */
  daysLeft: number | null;
};

const UNLIMITED: BotLifetime = { limited: false, lastDay: null, retired: false, daysLeft: null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function botLifetime(
  owner: { role: "admin" | "teacher" | "student"; endsOn: string | null },
  now: Date = new Date(),
  graceDays: number = BOT_LIMITS.retireAfterDays,
): BotLifetime {
  if (owner.role !== "student") return UNLIMITED;
  if (!owner.endsOn || !DATE_RE.test(owner.endsOn)) return UNLIMITED;

  const lastDay = addDays(owner.endsOn, graceDays);
  const today = berlinDate(now);
  const retired = today > lastDay;
  return {
    limited: true,
    lastDay,
    retired,
    daysLeft: retired ? null : daysBetween(today, lastDay) + 1,
  };
}

/** Дата YYYY-MM-DD в Берлине (часовой пояс курса). */
export function berlinDate(now: Date): string {
  // en-CA даёт формат YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** «12 декабря 2026 г.» для даты YYYY-MM-DD. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** «ещё 5 дней» */
export function daysLeftText(days: number): string {
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `ещё ${days} ${word}`;
}
