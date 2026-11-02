import { after, type NextRequest } from "next/server";
import { readJson } from "@/lib/server/bot/http";
import { isAdultOwner, lifetimeOf, loadBotById } from "@/lib/server/bot/store";
import { readUpdate } from "@/lib/server/bot/telegram";
import { planTelegramMessage, retireTelegram, runTelegramReply, sendTelegramText } from "@/lib/server/bot/telegram-flow";
import { matchesHash } from "@/lib/server/crypto";
import { isUuid } from "@/lib/server/dal/teacher";

/*
  POST /api/tg/[botId] — вебхук Telegram-бота ученика (18+) или ведущего.
    1. Секрет из заголовка X-Telegram-Bot-Api-Secret-Token сверяется с sha256-хешем в базе
       за постоянное время. Не совпал — 401 (Origin здесь не проверяется: запрос идёт от Telegram).
    2. Срок бота вышел — снимаем вебхук и стираем токен (лениво), отвечаем 200.
    3. Повторы отсекаются по update_id (уникальный индекс bot_messages).
    4. Ответ 200 сразу, модель и sendMessage — в after().
  proxy.ts этот путь не трогает (matcher исключает /api/tg/), cookie здесь нет.
*/

export const maxDuration = 60;

const ok = () => new Response(null, { status: 200 });
const unauthorized = () => new Response(null, { status: 401 });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/tg/[botId]">) {
  const { botId } = await ctx.params;
  if (!isUuid(botId)) return new Response(null, { status: 404 });
  const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || secret.length > 256) return unauthorized();

  try {
    const bot = await loadBotById(botId);
    if (!bot?.telegram.secretHash || !bot.telegram.token || !matchesHash(secret, bot.telegram.secretHash)) {
      return unauthorized();
    }

    let body: unknown;
    try {
      body = await readJson(request, 256 * 1024);
    } catch {
      // битое или огромное обновление: повторять незачем, отвечаем 200
      return ok();
    }
    const message = readUpdate(body);
    if (!message) return ok();

    const expired = lifetimeOf(bot).retired;
    if (!bot.active || expired || !isAdultOwner(bot.owner)) {
      const reason = expired ? "expired" : !bot.active ? "inactive" : "not_adult";
      after(() => retireTelegram(bot, reason).catch(logAfter("retire")));
      return ok();
    }

    const plan = await planTelegramMessage(bot, message);
    switch (plan.kind) {
      case "ignore":
        break;
      case "retire":
        after(() => retireTelegram(bot, plan.reason).catch(logAfter("retire")));
        break;
      case "send":
        after(() => sendTelegramText(bot, message.chatId, plan.text).catch(logAfter("send")));
        break;
      case "reply":
        after(() => runTelegramReply(bot, message.chatId, plan.input, plan.messageId).catch(logAfter("reply")));
        break;
    }
    return ok();
  } catch (error) {
    // 500 — Telegram повторит доставку позже; повтор отсечётся по update_id
    console.error("api.tg: unexpected error", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return new Response(null, { status: 500 });
  }
}

function logAfter(step: string) {
  return (error: unknown) =>
    console.error(`api.tg: after ${step} failed`, { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
}
