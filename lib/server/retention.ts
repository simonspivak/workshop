import "server-only";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { BOT_LEAD_RETENTION_DAYS, BOT_MESSAGE_RETENTION_DAYS } from "@/lib/platform/retention";

/*
  Сроки хранения гостевых данных ботов (аудит № 23, BP-4). Запускается из ночного обхода
  /api/jobs/sweep (Vercel Cron раз в сутки; без CRON_SECRET обход выключен — и чистка тоже).
  Удаляет SQL-функция sweep_bot_guest_data (миграция 20261116190000_privacy):
    • переписку гостей старше BOT_MESSAGE_RETENTION_DAYS дней (проверка владельцем — не трогается);
    • заявки ботов учеников через BOT_LEAD_RETENTION_DAYS дней после последнего урока группы.
  Не больше RETENTION_BATCH строк каждой таблицы за запуск: остальное — следующей ночью.
  Аккаунты учеников, их работы и файлы автоматически не удаляются никогда.
*/

/**
 * Строк каждой таблицы за один запуск (SQL принимает до 5000). Гостей — не больше 2000 сообщений
 * в сутки на платформу (settings.bot_guest_daily_global) плюс столько же ответов: 5000 за ночь
 * успевают за притоком.
 */
export const RETENTION_BATCH = 5000;

export type RetentionSummary = { botMessages: number; botLeads: number };

export async function sweepBotGuestData(): Promise<RetentionSummary> {
  const { data, error } = await createAdminClient().rpc("sweep_bot_guest_data", {
    p_message_days: BOT_MESSAGE_RETENTION_DAYS,
    p_lead_days: BOT_LEAD_RETENTION_DAYS,
    p_limit: RETENTION_BATCH,
  });
  if (error) throw new Error(`retention.sweepBotGuestData failed (${error.code})`);
  const row = data?.[0];
  return { botMessages: Number(row?.messages ?? 0), botLeads: Number(row?.leads ?? 0) };
}
