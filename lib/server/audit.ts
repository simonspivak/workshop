import "server-only";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Json } from "@/lib/server/supabase/types";

/**
 * Журнал аудита действий учителя и админа (и отказов модерации).
 * Логи Vercel живут час, поэтому журнал — в своей базе (audit_log, читает только админ).
 * Паролей, токенов и полных промптов сюда не пишем.
 */
export type AuditAction =
  | "group.create"
  | "group.update"
  | "group.pause"
  | "group.resume"
  | "students.create"
  | "student.password_reset"
  | "student.age_update"
  | "student.disable" // пишет SQL-функция set_student_disabled
  | "student.enable" // пишет SQL-функция set_student_disabled
  | "group.report_export" // ведущий скачал отчёт группы (CSV)
  | "stars.grant" // пишет SQL-функция grant_stars
  | "stars.grant_group" // пишет SQL-функция grant_stars_group (плюс stars.grant на каждого ученика)
  | "job.hide"
  | "job.unhide"
  | "job.delete" // ученик удалил свой результат (или ведущий — результат ученика)
  | "moderation.blocked"
  | "bot.telegram_connect"
  | "bot.telegram_disconnect"
  // этап B2: конструктор бота, экспорт заявок, снятие вебхука после срока жизни
  | "bot.create"
  | "bot.update"
  | "bot.leads_export"
  | "bot.telegram_retired"
  // пауза бота владельцем (аудит 8 ноября, № 9)
  | "bot.pause"
  | "bot.resume"
  // домашки: оценка ИИ (пишет сервер после проверки) и оценка ведущего
  | "homework.graded"
  | "homework.teacher_grade"
  // пульт админа: «Стоп генераций» и потолки ведущих
  | "settings.generation"
  | "settings.staff_limits"
  // вход: только аккаунты ведущих и админа (login/actions.ts); снятие блокировки входа ученика
  | "login.success"
  | "login.failed"
  | "student.login_unlock";

export async function audit(entry: {
  actorId: string | null;
  action: AuditAction;
  targetUser?: string | null;
  targetGroup?: string | null;
  meta?: Record<string, Json | undefined>;
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from("audit_log").insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_user: entry.targetUser ?? null,
      target_group: entry.targetGroup ?? null,
      meta: (entry.meta ?? {}) as Json,
    });
    if (error) console.error("audit: insert failed", { action: entry.action, code: error.code });
  } catch (error) {
    // Аудит не должен ронять действие пользователя
    console.error("audit: unexpected error", { action: entry.action, error: String(error) });
  }
}
