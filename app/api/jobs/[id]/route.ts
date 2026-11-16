import type { NextRequest } from "next/server";
import { AuthError, authorize, isStaff } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { advanceJob, loadJobForViewer, toJobView } from "@/lib/server/job-progress";
import { JOB_REQUEST_BUDGET_MS } from "@/lib/server/job-rules";

/*
  GET /api/jobs/[id] — состояние задачи для владельца или ведущего группы.
  Если задача не завершена, сервер сам спрашивает шлюз (не чаще, чем разрешает расписание
  lib/platform/job-poll.ts для действия и возраста задачи; иначе — ответ из базы), копирует
  готовый файл в Storage и возвращает звёзды за неудачную или зависшую задачу
  (правила — lib/server/job-rules.ts). Ссылки на файлы подписаны на час.
*/

// копирование результата в Storage идёт в after() и укладывается в эту минуту:
// скачивание и загрузка обрываются через JOB_REQUEST_BUDGET_MS (55 с) от начала запроса
export const maxDuration = 60;

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const deadline = Date.now() + JOB_REQUEST_BUDGET_MS;
  try {
    const user = await authorize();
    const { id } = await ctx.params;
    const job = await loadJobForViewer(user, id);
    // удалённая владельцем задача наружу не отдаётся — как будто её нет
    if (!job || job.deleted_at) return json({ error: "not_found" }, 404);
    const current = await advanceJob(job, { deadline });
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
