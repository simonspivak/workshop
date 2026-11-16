import { after, type NextRequest } from "next/server";
import { ConfigError } from "@/lib/server/env";
import { processJobCallback, verifyJobCallback } from "@/lib/server/job-callback";
import { JOB_REQUEST_BUDGET_MS } from "@/lib/server/job-rules";

/*
  POST /api/jobs/callback?job=<id>&sig=<подпись> — kie сообщает, что задача закончилась
  (адрес выдаёт lib/server/job-callback.ts, шлюз передаёт его kie как callBackUrl).

  - Подпись проверяется первой: без верной подписи — 404 без подробностей, ни базы, ни шлюза.
  - Тело запроса не читается: вызов — только сигнал «проверь задачу сейчас». Статус и ссылки на
    результат берутся у шлюза, как при опросе (advanceJob), копирование — в after() с тем же сроком
    55 с, что у GET /api/jobs/[id].
  - Ответ 200 сразу, до проверки: kie ждёт ответа не дольше 15 с и повторяет вызов при таймауте.
    Повторные вызовы безвредны: готовую или неудачную задачу проверка не трогает.
  - В ответе нет данных задачи. Origin не проверяется: зовёт сервер kie, доступ — только по подписи.
  - GET с тем же адресом (проверка доступности адреса) — 200 при верной подписи, без работы.
*/

// проверка у шлюза (до 15 с) и копирование результата в after() укладываются в эту минуту
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  const deadline = Date.now() + JOB_REQUEST_BUDGET_MS;
  const jobId = verified(request);
  if (jobId instanceof Response) return jobId;
  after(async () => {
    try {
      await processJobCallback(jobId, deadline);
    } catch (error) {
      // задачу доведёт опрос; в лог — без данных задачи
      console.error("api.jobs.callback: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return json({ ok: true }, 200);
}

export async function GET(request: NextRequest): Promise<Response> {
  const jobId = verified(request);
  return jobId instanceof Response ? jobId : json({ ok: true }, 200);
}

function verified(request: NextRequest): string | Response {
  try {
    return verifyJobCallback(request.nextUrl.searchParams) ?? json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof ConfigError) return json({ error: "not_configured" }, 503);
    console.error("api.jobs.callback: verify failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "server_error" }, 500);
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private" } });
}
