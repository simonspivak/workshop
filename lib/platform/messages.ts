// Тексты платформы, которые нужны и серверу, и браузеру: коды ошибок и подписи.
// Секретов и серверной логики здесь нет — файл можно импортировать в клиентские компоненты.

export type AgeBand = "u16" | "16_17" | "adult";
export type AppRole = "admin" | "teacher" | "student";
export type GroupKind = "teens" | "adults" | "corporate" | "individual" | "demo";

export const ageBandLabels: Record<AgeBand, string> = {
  u16: "до 16",
  "16_17": "16–17",
  adult: "18+",
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Админ",
  teacher: "Ведущий",
  student: "Ученик",
};

export const groupKindLabels: Record<GroupKind, string> = {
  teens: "Подростки",
  adults: "Взрослые",
  corporate: "Корпоративная",
  individual: "Индивидуально",
  demo: "Демо",
};

export const ledgerReasonLabels: Record<string, string> = {
  welcome: "Стартовые звёзды",
  grant: "Начислил ведущий",
  adjust: "Снял ведущий",
  debit: "Генерация",
  refund: "Возврат за неудачную генерацию",
  quiz_bonus: "Бонус за тест",
  bot_reply: "Ответ бота",
};

/** Коды ошибок, которые сервер отдаёт наружу. Подробности остаются в логах. */
export const errorMessages = {
  unauthorized: "Войдите, чтобы продолжить.",
  forbidden: "Это действие вам недоступно.",
  not_found: "Не нашли. Возможно, это удалили.",
  not_configured: "Платформа ещё не подключена. Сообщите ведущему.",
  invalid_input: "Проверьте поля формы.",
  rate_limited: "Слишком много попыток. Подождите пару минут.",
  server_error: "Что-то пошло не так. Попробуйте ещё раз.",
  // звёзды и генерации
  insufficient_stars: "Не хватает звёзд.",
  group_paused: "Ведущий поставил группу на паузу.",
  daily_cap: "Дневной лимит звёзд группы исчерпан. Продолжим завтра.",
  generation_disabled: "Генерации временно выключены.",
  too_many_jobs: "Уже идёт несколько генераций. Дождитесь результата.",
  unknown_model: "Эта модель недоступна.",
  user_disabled: "Аккаунт отключён. Обратитесь к ведущему.",
  user_not_found: "Пользователь не найден.",
  job_not_found: "Задача не найдена.",
  bad_amount: "Неверное количество звёзд.",
  // доступ к моделям
  staff_only: "Эта модель только для ведущего.",
  adult_only: "Эта модель доступна только с 18 лет.",
  google_minors: "Модели Google доступны с 18 лет. Ведущий может включить их для группы.",
  consent_required: "Нужна отметка о согласии родителей. Сообщите ведущему.",
  // модерация
  stop_word: "В запросе есть слова, которые нельзя использовать на курсе. Переформулируйте.",
  phone: "Похоже на номер телефона. Не пишите в запросах личные данные.",
  email: "Похоже на e-mail. Не пишите в запросах личные данные.",
  address: "Похоже на адрес. Не пишите в запросах личные данные.",
  card: "Похоже на номер карты. Не пишите в запросах личные данные.",
  too_long: "Слишком длинный текст.",
  // учитель
  group_code_taken: "Такой код группы уже занят.",
  too_many_students: "За один раз — не больше 40 учеников.",
} as const;

export type ErrorCode = keyof typeof errorMessages;

export function errorMessage(code: string | undefined | null): string {
  if (!code) return errorMessages.server_error;
  return (errorMessages as Record<string, string>)[code] ?? errorMessages.server_error;
}

/** Результат Server Action: только то, что нужно интерфейсу. */
export type ActionResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode; fields?: Record<string, string> };
