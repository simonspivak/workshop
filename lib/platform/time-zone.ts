// Часовой пояс платформы — одно место для всего TypeScript-кода (сервер и браузер).
// По нему считаются «сегодня» в отчёте группы, последний день бота, дневная соль хешей гостей бота
// и время в галерее, ленте звёзд, заявках и домашках. Пока Europe/Berlin: менять границу дня
// посреди курса нельзя — сдвинутся траты «за сегодня» у идущей группы.
// Как поменять и какие SQL-функции держат ту же зону — docs/platform/spec.md §9.1.

export const PLATFORM_TIME_ZONE = "Europe/Berlin";

/** Для подписей: «День считается по Берлину». Меняется вместе с PLATFORM_TIME_ZONE. */
export const PLATFORM_TIME_ZONE_CITY = "Берлину";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLATFORM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Дата YYYY-MM-DD в часовом поясе платформы (en-CA даёт именно этот формат). */
export function platformDate(at: Date): string {
  return dayFormat.format(at);
}
