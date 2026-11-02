import type { NextRequest } from "next/server";
import { AuthError, authorize } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { generateRequestSchema, isSameOriginRequest, startGeneration } from "@/lib/server/generate";

/*
  POST /api/generate — запуск генерации (docs/platform/spec.md §3).
  Ответ: 202 { jobId } — задача создана, статус спрашивать в GET /api/jobs/[id];
         200 { jobId, job } — текст (синхронно);
         4xx/5xx { error } — код из lib/platform/messages.ts или generation-messages.ts.
*/

// синхронный текст ждёт модель до 60 секунд
export const maxDuration = 60;

const MAX_BODY_CHARS = 64 * 1024;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "bad_origin" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "invalid_input" }, 415);
  }

  try {
    const user = await authorize();

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: "invalid_input" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_input" }, 400);
    }
    const parsed = generateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "invalid_input", field: String(parsed.error.issues[0]?.path[0] ?? "") }, 400);
    }

    const outcome = await startGeneration(user, parsed.data);
    switch (outcome.kind) {
      case "accepted":
        return json({ jobId: outcome.jobId, balance: outcome.balance, reused: outcome.reused }, 202);
      case "text":
        return json({ jobId: outcome.job.id, job: outcome.job, balance: outcome.balance }, 200);
      case "error":
        return json({ error: outcome.error, field: outcome.field, jobId: outcome.jobId }, outcome.status);
    }
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.code }, error.code === "unauthorized" ? 401 : 403);
    if (error instanceof ConfigError) return json({ error: "not_configured" }, 503);
    console.error("api.generate: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "server_error" }, 500);
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
