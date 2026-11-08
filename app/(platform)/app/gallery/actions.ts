"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthError, authorize } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { deleteJob } from "@/lib/server/gallery";

export type DeleteJobResult = { ok: true } | { ok: false; error: string };

/**
 * Удалить результат (мягко: jobs.deleted_at, файлы из Storage убираются, звёзды не возвращаются).
 * Свой — любой пользователь, ученика своей группы — ведущий, любой — админ. Только готовые
 * или неудачные задачи. Пишет audit_log (job.delete). Проверку прав делает deleteJob.
 */
export async function deleteJobAction(jobId: string): Promise<DeleteJobResult> {
  try {
    const user = await authorize();
    const parsed = z.uuid().safeParse(jobId);
    if (!parsed.success) return { ok: false, error: "not_found" };
    const result = await deleteJob(user, parsed.data);
    if (!result.ok) return result;
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.code };
    if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
    console.error("gallery.deleteJobAction: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "server_error" };
  }
}
