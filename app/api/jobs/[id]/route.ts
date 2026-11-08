import type { NextRequest } from "next/server";
import { AuthError, authorize, isStaff } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { advanceJob, loadJobForViewer, toJobView } from "@/lib/server/job-progress";

/*
  GET /api/jobs/[id] — состояние задачи для владельца или ведущего группы.
  Если задача не завершена, сервер сам спрашивает шлюз (не чаще раза в 5 секунд), копирует
  готовый файл в Storage и возвращает звёзды за неудачную или зависшую задачу
  (правила — lib/server/job-rules.ts). Ссылки на файлы подписаны на час.
*/

// копирование результата в Storage идёт в after() и укладывается в эту минуту
export const maxDuration = 60;

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  try {
    const user = await authorize();
    const { id } = await ctx.params;
    const job = await loadJobForViewer(user, id);
    // удалённая владельцем задача наружу не отдаётся — как будто её нет
    if (!job || job.deleted_at) return json({ error: "not_found" }, 404);
    const current = await advanceJob(job);
    return json({ job: await toJobView(current, { revealHidden: isStaff(user) }) }, 200);
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.code }, error.code === "unauthorized" ? 401 : 403);
    if (error instanceof ConfigError) return json({ error: "not_configured" }, 503);
    console.error("api.jobs: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "server_error" }, 500);
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private" } });
}
