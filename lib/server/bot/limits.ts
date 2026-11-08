import "server-only";

/*
  Лимиты ботов (docs/platform/spec.md §5, docs/course/lesson-3.md §8.3 и §14.4).
  Длины характера и знаний совпадают с check-ограничениями таблицы bots в миграции.
*/
export const BOT_LIMITS = {
  nameMax: 60,
  soulMax: 4000,
  knowledgeMax: 8000,
  /** длина одного сообщения гостя */
  messageMax: 1000,
  /** сколько последних сообщений диалога уходит в модель */
  historyMessages: 10,
  /** сообщений в час с одного IP (веб) или из одного чата (Telegram), на все боты */
  senderPerHour: 30,
  /** сообщений гостей в сутки на бота (без проверки владельцем) */
  botPerDay: 200,
  /** заявок в сутки на бота и из одного диалога */
  leadsPerBotPerDay: 50,
  leadsPerConversationPerDay: 3,
  /** открыток гостям в сутки на бота (только у ботов взрослых владельцев) */
  cardsPerBotPerDay: 3,
  /** бот работает до groups.ends_on + 14 дней */
  retireAfterDays: 14,
  /** ответ бота короткий: до 800 токенов — базовая цена 1★ */
  replyMaxTokens: 400,
  /** модель мозга бота */
  model: "claude-haiku-5-5",
} as const;
