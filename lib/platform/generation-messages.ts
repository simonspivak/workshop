// Коды ошибок генераций, галереи и уроков (этап B1). Дополняют lib/platform/messages.ts.
// Файл можно импортировать в клиентские компоненты: здесь только тексты.

import { errorMessage } from "@/lib/platform/messages";

export const generationErrorMessages = {
  bad_origin: "Запрос пришёл не со страницы курса. Обновите страницу и попробуйте ещё раз.",
  bad_reference: "Этот файл нельзя подставить. Выберите свой готовый результат из галереи.",
  reference_required: "Выберите файл из галереи.",
  library_only: "Видео с движением — только из библиотеки курса.",
  library_empty: "Библиотека движений курса пока пуста. Спросите ведущего.",
  lipsync_audio: "Для «говорящей головы» нужна своя озвучка реплики из галереи, не длиннее 15 секунд. Длинный текст разрежьте на куски.",
  gateway_error: "Сервис ИИ сейчас перегружен или не ответил. Звёзды вернулись — подожди минуту и попробуй ещё раз.",
  generation_failed: "Генерация не получилась. Звёзды вернулись.",
  timeout: "Генерация шла слишком долго. Звёзды вернулись.",
  gateway_lost: "Связь с сервисом генерации оборвалась. Звёзды вернулись.",
  result_unavailable: "Не удалось сохранить результат. Звёзды вернулись.",
  quiz_incomplete: "Ответьте на все вопросы.",
  lesson_not_found: "Такого урока нет.",
} as const;

export type GenerationErrorCode = keyof typeof generationErrorMessages;

/** Текст для кода ошибки: сначала коды B1, потом общие из messages.ts. */
export function platformErrorMessage(code: string | null | undefined): string {
  if (code && code in generationErrorMessages) return generationErrorMessages[code as GenerationErrorCode];
  return errorMessage(code);
}
