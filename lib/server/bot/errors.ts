import "server-only";
import { AuthError } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { errorMessage } from "@/lib/platform/messages";

/*
  Коды ошибок бота и их тексты. Текст собирается на сервере, в браузер уходит код и готовое
  сообщение (клиентские компоненты не импортируют серверные модули).
*/

const BOT_ERRORS: Record<string, string> = {
  bot_missing: "Сначала создайте бота.",
  bot_retired: "Срок бота на платформе закончился. Заберите его с собой.",
  slug_taken: "Такой адрес уже занят. Попробуйте другой.",
  slug_invalid: "Адрес: латиница, цифры и дефисы, от 3 до 40 символов.",
  contact_adult_only: "Поле «Контакт» доступно только с 18 лет.",
  lead_form_required: "Добавьте в форму заявки хотя бы одно поле.",
  tools_too_large: "Форма заявки слишком большая: сократите подписи и варианты.",
  avatar_invalid: "Эту картинку нельзя поставить аватаром.",
  telegram_adult_only: "Telegram доступен только с 18 лет. Делитесь ссылкой на страницу бота: она работает и с телефона.",
  telegram_token_invalid: "Telegram не принял токен. Скопируйте его из @BotFather целиком.",
  telegram_taken: "Этот Telegram-бот уже подключён к другому боту на платформе.",
  telegram_failed: "Telegram не ответил. Попробуйте ещё раз через минуту.",
  app_url_missing: "Не задан адрес сайта (APP_URL). Сообщите ведущему.",
  card_unavailable: "Открытку здесь сейчас нарисовать нельзя.",
  card_ticket: "Кнопка устарела. Попросите бота нарисовать ещё раз.",
  card_limit: "Открыток на сегодня уже много. Приходите завтра.",
  bad_origin: "Запрос пришёл не со страницы бота.",
  owner_stop_word:
    "Здесь есть слова из стоп-списка курса. Если это список запретов — не перечисляйте опасные темы: правила платформы над характером их уже запрещают. Напишите, например, «без взрослых и опасных тем».",
  phone: "Похоже на номер телефона. У ботов участников младше 18 личных данных быть не должно.",
  email: "Похоже на e-mail. У ботов участников младше 18 личных данных быть не должно.",
  address: "Похоже на адрес. У ботов участников младше 18 личных данных быть не должно.",
};

export function botErrorMessage(code: string): string {
  return BOT_ERRORS[code] ?? errorMessage(code);
}

/** Результат Server Action бота: код и готовый текст ошибки. */
export type BotActionResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message: string; fields?: Record<string, string> };

export function botFail(error: string, fields?: Record<string, string>): { ok: false; error: string; message: string; fields?: Record<string, string> } {
  return { ok: false, error, message: botErrorMessage(error), ...(fields ? { fields } : {}) };
}

/** Перевести исключение в ответ: права и настройки — свои коды, остальное — server_error в логах. */
export function botFailFromError(error: unknown, op: string) {
  if (error instanceof AuthError) return botFail(error.code);
  if (error instanceof ConfigError) return botFail("not_configured");
  console.error(`bot.${op}: unexpected error`, { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
  return botFail("server_error");
}
