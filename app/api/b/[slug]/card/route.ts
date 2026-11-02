import type { NextRequest } from "next/server";
import { z } from "zod";
import { pollCard } from "@/lib/server/bot/card";
import { botFail } from "@/lib/server/bot/errors";
import { jsonResponse } from "@/lib/server/bot/http";
import { BOT_SESSION_COOKIE, isSessionId, webConversationId } from "@/lib/server/bot/secrets";
import { SLUG_RE } from "@/lib/server/bot/slug";
import { loadBotBySlug } from "@/lib/server/bot/store";
import { getUser } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";

/*
  GET /api/b/[slug]/card?id=<job> — статус открытки (ленивый опрос шлюза, как /api/jobs/[id]).
  Гость видит только открытки своего диалога (cookie сессии), владелец — открытки своего бота.
  Готовая картинка — подписанная ссылка Storage на час.
*/

export const maxDuration = 60;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/b/[slug]/card">) {
  const { slug } = await ctx.params;
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get("id"));
  if (!SLUG_RE.test(slug) || !id.success) return jsonResponse(botFail("not_found"), 404);

  try {
    const bot = await loadBotBySlug(slug);
    if (!bot) return jsonResponse(botFail("not_found"), 404);

    const user = await getUser();
    const session = request.cookies.get(BOT_SESSION_COOKIE)?.value;
    const status =
      user?.id === bot.ownerId
        ? await pollCard(bot, id.data, { owner: true })
        : isSessionId(session)
          ? await pollCard(bot, id.data, { conversationId: webConversationId(session) })
          : null;
    if (!status) return jsonResponse(botFail("not_found"), 404);
    return jsonResponse({ ok: true, ...status });
  } catch (error) {
    if (error instanceof ConfigError) return jsonResponse(botFail("not_configured"), 503);
    console.error("api.b.card: unexpected error", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return jsonResponse(botFail("server_error"), 500);
  }
}
