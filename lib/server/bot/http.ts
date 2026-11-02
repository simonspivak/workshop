import "server-only";
import { appUrl } from "@/lib/server/env";

/*
  Мелочи для Route Handlers бота: проверка Origin у POST (spec §8), чтение тела с лимитом.
*/

/**
 * POST пришёл со страниц этого же сайта: Origin совпадает с хостом запроса
 * (x-forwarded-host / host — как у проверки Server Actions в Next.js) или с APP_URL.
 * Запросы без Origin и межсайтовые (Sec-Fetch-Site: cross-site) отклоняются.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  if (host && originUrl.host === host) return true;
  const app = appUrl();
  try {
    return Boolean(app && new URL(app).origin === originUrl.origin);
  } catch {
    return false;
  }
}

export class BodyError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super(`body_${status}`);
    this.name = "BodyError";
  }
}

/** Тело JSON не больше maxBytes. Иначе BodyError (413 — слишком большое, 400 — не JSON). */
export async function readJson(request: Request, maxBytes: number, options: { requireJsonType?: boolean } = {}): Promise<unknown> {
  if (options.requireJsonType && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new BodyError(415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new BodyError(413);
  if (!request.body) throw new BodyError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyError(413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyError(400);
  }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}
