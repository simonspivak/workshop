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
  | "stars.grant" // пишет SQL-функция grant_stars
  | "job.hide"
  | "job.unhide"
  | "moderation.blocked"
  | "bot.telegram_connect"
  | "bot.telegram_disconnect";

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
