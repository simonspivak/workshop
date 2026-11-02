import "server-only";
import { audit } from "@/lib/server/audit";
import { acceptMessage, completeMessage, type BrainInput, type BrainResult } from "@/lib/server/bot/brain";
import { defaultGreeting, parseSoulExtras } from "@/lib/server/bot/prompt";
import { hashSender, ownerLinkCode, sameCode, telegramConversationId } from "@/lib/server/bot/secrets";
import { setTelegramOwnerChat, wipeTelegram, type BotRecord } from "@/lib/server/bot/store";
import { deleteWebhook, readCommand, sendMessage, sendTyping, type TelegramMessage } from "@/lib/server/bot/telegram";
import { decryptSecret } from "@/lib/server/crypto";

/*
  Обработка входящего сообщения Telegram (вызывается из POST /api/tg/[botId] после проверки
  секрета). Быстрая часть — до ответа 200: команды, модерация, запись сообщения с update_id
  (повтор отсекается уникальным индексом). Медленная часть (модель, отправка) — в after().
*/

export type TelegramPlan =
  | { kind: "ignore" }
  | { kind: "retire"; reason: "expired" | "inactive" | "not_adult" }
  | { kind: "send"; text: string }
  | { kind: "reply"; input: BrainInput; messageId: number };

export const TELEGRAM_TEXTS = {
  onlyText: "Я пока понимаю только текст.",
  ownerLinked: "Готово: сюда будут приходить уведомления о новых заявках.",
  ownerLinkBad: "Ссылка для уведомлений устарела. Откройте свежую на платформе: «Мой бот» → Telegram.",
  leadSaved: "✓ Заявка отправлена организаторам.",
} as const;

export async function planTelegramMessage(bot: BotRecord, message: TelegramMessage): Promise<TelegramPlan> {
  if (message.chatType !== "private" || message.fromIsBot) return { kind: "ignore" };
  if (!message.text) return { kind: "send", text: TELEGRAM_TEXTS.onlyText };

  let text = message.text.trim();
  const command = readCommand(text);
  if (command) {
    if (command.command === "start" && command.payload.startsWith("owner_")) {
      const { botId, connectedAt } = bot.telegram;
      const expected = botId && connectedAt ? ownerLinkCode(bot.id, botId, connectedAt) : "";
      if (expected && sameCode(command.payload.slice("owner_".length), expected)) {
        await setTelegramOwnerChat(bot.id, message.chatId);
        return { kind: "send", text: TELEGRAM_TEXTS.ownerLinked };
      }
      return { kind: "send", text: TELEGRAM_TEXTS.ownerLinkBad };
    }
    if (command.command === "start" || command.command === "help") {
      return { kind: "send", text: parseSoulExtras(bot.soul).greeting ?? defaultGreeting(bot.name) };
    }
    if (command.command === "signup") text = "Хочу оставить заявку.";
    else if (command.command === "card") text = "Нарисуй открытку.";
  }

  const input: BrainInput = {
    bot,
    channel: "telegram",
    conversationId: telegramConversationId(message.chatId),
    preview: false,
    text,
    chargeKey: `tg:${bot.id}:${message.updateId}`,
    senderHash: hashSender("tg", String(message.chatId)),
    telegramUpdateId: message.updateId,
  };
  const accepted = await acceptMessage(input);
  if (accepted.status === "accepted") return { kind: "reply", input, messageId: accepted.messageId };
  if (accepted.status === "retired") return { kind: "retire", reason: "expired" };
  if (accepted.status === "duplicate") return { kind: "ignore" };
  return { kind: "send", text: accepted.text };
}

/** Медленная часть: модель и ответ. Вызывать в after(). */
export async function runTelegramReply(bot: BotRecord, chatId: number, input: BrainInput, messageId: number): Promise<void> {
  if (!bot.telegram.token) return;
  const token = decryptSecret(bot.telegram.token);
  await sendTyping(token, chatId);
  let result: BrainResult;
  try {
    result = await completeMessage(input, messageId);
  } catch (error) {
    console.error("tg.reply: brain failed", { bot: bot.id, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    result = { status: "error", text: "Что-то сломалось. Попробуйте ещё раз чуть позже." };
  }
  const text = result.status === "ok" && result.lead === "saved" ? `${result.text}\n\n${TELEGRAM_TEXTS.leadSaved}` : result.text;
  if (text) await sendMessage(token, chatId, text);
}

export async function sendTelegramText(bot: BotRecord, chatId: number, text: string): Promise<void> {
  if (!bot.telegram.token) return;
  await sendMessage(decryptSecret(bot.telegram.token), chatId, text);
}

/**
 * Срок бота вышел (или его сняли с публикации, или владельцу больше нет 18): снять вебхук
 * и стереть токен. Вызывается лениво — при первом входящем сообщении после срока.
 */
export async function retireTelegram(bot: BotRecord, reason: "expired" | "inactive" | "not_adult"): Promise<void> {
  if (bot.telegram.token) {
    const removed = await deleteWebhook(decryptSecret(bot.telegram.token)).catch(() => null);
    if (!removed?.ok) console.error("tg.retire: deleteWebhook failed", { bot: bot.id });
  }
  await wipeTelegram(bot.id);
  await audit({
    actorId: null,
    action: "bot.telegram_retired",
    targetUser: bot.ownerId,
    targetGroup: bot.owner.group?.id ?? null,
    meta: { bot: bot.id, reason, username: bot.telegram.username },
  });
}
