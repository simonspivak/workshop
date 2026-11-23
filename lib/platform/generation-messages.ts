// Коды ошибок генераций, галереи и уроков (этап B1). Дополняют lib/platform/messages.ts.
// Файл можно импортировать в клиентские компоненты: здесь только тексты.

import { formatDriverSeconds, MOTION_DRIVER_MAX_SEC, STUDENT_LIPSYNC_MAX_SEC } from "@/lib/platform/generation-types";
import { errorMessage } from "@/lib/platform/messages";

export const generationErrorMessages = {
  bad_origin: "Запрос пришёл не со страницы курса. Обновите страницу и попробуйте ещё раз.",
  bad_reference: "Этот файл нельзя подставить. Выберите свой готовый результат из галереи.",
  reference_required: "Выберите файл из галереи.",
  library_only: "Видео с движением — только из библиотеки курса.",
  library_empty: "Библиотека движений курса пока пуста. Спросите ведущего.",
  lipsync_audio: `Для «говорящей головы» нужна своя озвучка реплики из галереи, не длиннее ${STUDENT_LIPSYNC_MAX_SEC} секунд. Длинный текст разрежьте на куски.`,
  motion_too_long: `Образец длиннее ${MOTION_DRIVER_MAX_SEC} секунд. Выберите другой или попросите ведущего обрезать его.`,
  motion_unchecked: "Не удалось проверить длину образца. Попробуйте через минуту или выберите другой образец.",
  gateway_error:"Сервис ИИ сейчас перегружен или не ответил. Звёзды вернулись — подожди минуту и попробуй ещё раз.",
  gateway_unavailable: "Генерации временно недоступны: сообщите ведущему. Звёзды вернулись.",
  gateway_rejected: "Сервис генерации отклонил этот запрос. Звёзды вернулись. Если повторится — сообщите ведущему.",
  // ответ /api/generate не дошёл (обрыв на сервере): повтор с тем же ключом не спишет второй раз
  request_lost:
    "Ответ не дошёл. Если звёзды списались, они вернутся сами через пару минут. Можно нажать ещё раз — второй раз не спишется.",
  generation_failed: "Генерация не получилась. Звёзды вернулись.",
  timeout: "Генерация шла слишком долго. Звёзды вернулись.",
  gateway_lost: "Связь с сервисом генерации оборвалась. Звёзды вернулись.",
  result_unavailable: "Не удалось сохранить результат. Звёзды вернулись.",
  result_too_large: "Результат получился слишком большим (больше 50 МБ) и не сохранился. Звёзды вернулись.",
  job_active: "Эта задача ещё выполняется. Удалить можно готовый или неудавшийся результат.",
  quiz_incomplete: "Ответьте на все вопросы.",
  lesson_not_found: "Такого урока нет.",
} as const;

export type GenerationErrorCode = keyof typeof generationErrorMessages;

/**
 * Текст для кода ошибки: сначала коды B1, потом общие из messages.ts.
 * seconds — длина файла из ответа сервера (lipsync_audio): тогда текст говорит, сколько длится озвучка.
 */
export function platformErrorMessage(code: string | null | undefined, details: { seconds?: number | null } = {}): string {
  if (code === "lipsync_audio" && typeof details.seconds === "number" && details.seconds > 0) {
    return lipsyncTooLongMessage(details.seconds);
  }
  if (code && code in generationErrorMessages) return generationErrorMessages[code as GenerationErrorCode];
  return errorMessage(code);
}

/** «Озвучка длится 22 с — для говорящей головы нужно не больше 20 с. …» */
export function lipsyncTooLongMessage(seconds: number): string {
  return (
    `Озвучка длится ${formatDriverSeconds(seconds)} — для говорящей головы нужно не больше ${STUDENT_LIPSYNC_MAX_SEC} с. ` +
    "Сократи реплику на пару слов или раздели её на две."
  );
}
