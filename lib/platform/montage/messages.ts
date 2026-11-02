import { errorMessage } from "@/lib/platform/messages";
import type { MontageErrorCode } from "./pipeline";

// Тексты студии монтажа для интерфейса. Общие коды ошибок — в lib/platform/messages.ts.

export const CAPCUT_FALLBACK =
  "Запасной путь — смонтировать вручную в CapCut: клипы по порядку, каждая реплика на своём клипе, " +
  "музыка тихо под голосом, субтитры и титр «Сделано с ИИ».";

const montageErrors: Record<MontageErrorCode, string> = {
  unsupported: "Этот браузер не умеет монтировать видео: нужен свежий Chrome, Edge, Firefox или Safari (iOS 15+).",
  core_failed: "Не удалось загрузить модуль монтажа. Проверьте интернет и попробуйте ещё раз.",
  download_failed: "Не удалось скачать файл из галереи. Обновите список и попробуйте ещё раз.",
  probe_failed: "Один из файлов не читается как видео или звук. Уберите его или сгенерируйте заново.",
  too_long: "Ролик длиннее 60 секунд. Уберите сцену или сократите реплики.",
  too_many_scenes: "Не больше 12 сцен в одном ролике.",
  no_scenes: "Добавьте хотя бы одну сцену.",
  ffmpeg_failed: "Монтаж не получился. Попробуйте ещё раз; если повторится — уберите последнюю добавленную сцену.",
  out_of_memory: "Устройству не хватило памяти. Уберите пару сцен или смонтируйте на компьютере.",
  cancelled: "Монтаж остановлен.",
};

export function montageErrorText(code: MontageErrorCode): string {
  return montageErrors[code] ?? montageErrors.ffmpeg_failed;
}

const studioErrors: Record<string, string> = {
  upload_missing: "Файл не дошёл до хранилища. Попробуйте сохранить ещё раз.",
  too_large: "Ролик больше 50 МБ — такой не сохранить. Сократите его.",
  bad_file: "Хранилище получило не тот файл. Смонтируйте заново.",
  job_failed: "Это сохранение уже закрыто. Смонтируйте ещё раз и сохраните.",
  upload_failed: "Загрузка оборвалась. Проверьте интернет и нажмите «Сохранить» ещё раз.",
};

/** Текст ошибки сервера студии (свои коды + общие из lib/platform/messages.ts). */
export function studioErrorText(code: string | null | undefined): string {
  return (code && studioErrors[code]) || errorMessage(code);
}

const fieldNames: Record<string, string> = {
  title: "в названии",
  authors: "в никах авторов",
  subtitles: "в тексте субтитров",
};

export function moderationFieldText(field: string | undefined): string {
  return (field && fieldNames[field]) || "";
}

const secondsFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** 30.5 → «30,5 с» */
export function formatSeconds(seconds: number): string {
  return `${secondsFormat.format(Math.round(seconds * 10) / 10)} с`;
}

/** Промежуток времени округлённо: «40 с», «2 мин». */
export function formatSpan(seconds: number): string {
  if (seconds < 90) return `${Math.max(5, Math.round(seconds / 5) * 5)} с`;
  return `${Math.round(seconds / 60)} мин`;
}

/** Остаток времени: «меньше 10 с», «≈ 40 с», «≈ 2 мин». */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "оцениваем…";
  if (seconds < 10) return "меньше 10 с";
  return `≈ ${formatSpan(seconds)}`;
}

export function formatMegabytes(bytes: number): string {
  return `${secondsFormat.format(Math.round((bytes / 1024 / 1024) * 10) / 10)} МБ`;
}
