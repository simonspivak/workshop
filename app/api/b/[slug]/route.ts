import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleMessage } from "@/lib/server/bot/brain";
import { startCard } from "@/lib/server/bot/card";
import { toChatReply } from "@/lib/server/bot/chat";
import { botFail } from "@/lib/server/bot/errors";
import { BodyError, isSameOrigin, jsonResponse, readJson } from "@/lib/server/bot/http";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { clientIp, ipRateLimitKey } from "@/lib/server/bot/ratelimit";
import { BOT_SESSION_COOKIE, hashSender, isSessionId, newSessionId, webConversationId } from "@/lib/server/bot/secrets";
import { SLUG_RE } from "@/lib/server/bot/slug";
import { loadBotBySlug } from "@/lib/server/bot/store";
import { ConfigError, isDevelopment } from "@/lib/server/env";

/*
  POST /api/b/[slug] — веб-чат публичной страницы бота (без входа).
    { type: "message", text, messageId } → ответ бота (тот же мозг, 1★ со звёзд владельца)
    { type: "card", ticket }             → нарисовать открытку после подтверждения гостем
    { type: "reset" }                    → «Новый диалог»: новая сессия гостя (новая cookie), история
                                           на экране пустая; старая переписка этой cookie больше не видна
  Защита: Origin этого сайта, тело до 8 КБ, лимиты (в мозге): 30 сообщений в час от посетителя
  (сессия из cookie), 600 в час из одной сети (хеш IP), 200 в сутки на бота и общий потолок платформы.
  Сессия гостя — случайный id в httpOnly cookie. IP не хранится, только хеш с солью.
*/

export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(BOT_LIMITS.messageMax), messageId: z.uuid() }),
  z.object({ type: z.literal("card"), ticket: z.string().min(10).max(2000) }),
  z.object({ type: z.literal("reset") }),
]);

const cookieOptions = () =>
  ({ httpOnly: true, sameSite: "lax", secure: !isDevelopment(), path: "/", maxAge: 30 * 24 * 3600 }) as const;

function fail(error: string, status: number) {
  return jsonResponse(botFail(error), status);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/b/[slug]">) {
  if (!isSameOrigin(request)) return fail("bad_origin", 403);
  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) return fail("not_found", 404);

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await readJson(request, 8 * 1024, { requireJsonType: true }));
    if (!parsed.success) return fail("invalid_input", 400);
    body = parsed.data;
  } catch (error) {
    return fail("invalid_input", error instanceof BodyError ? error.status : 400);
  }

  // «Новый диалог» (общий компьютер в классе): только новая cookie, в базе ничего не трогаем
  if (body.type === "reset") {
    const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    response.cookies.set(BOT_SESSION_COOKIE, newSessionId(), cookieOptions());
    return response;
  }

  const existing = request.cookies.get(BOT_SESSION_COOKIE)?.value;
  const sessionId = isSessionId(existing) ? existing : newSessionId();
  const conversationId = webConversationId(sessionId);

  try {
    const bot = await loadBotBySlug(slug);
    if (!bot) return fail("not_found", 404);

    let payload: unknown;
    if (body.type === "message") {
      const ip = clientIp(request.headers) ?? "unknown";
      const result = await handleMessage({
        bot,
        channel: "web",
        conversationId,
        preview: false,
        text: body.text,
        chargeKey: `bot:${bot.id}:${body.messageId}`,
        // Лимит посетителя — по conversationId (cookie); хеш IP — только потолок сети.
        // IPv6 — по сети /64: иначе потолок обходится сменой адреса
        senderHash: hashSender("ip", ipRateLimitKey(ip)),
      });
      payload = toChatReply(result, { botId: bot.id, conversationId });
    } else {
      const result = await startCard({ bot, conversationId, preview: false, ticket: body.ticket });
      payload = result.ok ? result : botFail(result.error);
    }

    const response = NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
    if (existing !== sessionId) {
      response.cookies.set(BOT_SESSION_COOKIE, sessionId, cookieOptions());
    }
    return response;
  } catch (error) {
    if (error instanceof ConfigError) return fail("not_configured", 503);
    console.error("api.b: unexpected error", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return fail("server_error", 500);
  }
}
