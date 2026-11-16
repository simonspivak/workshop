import "server-only";
import { audit } from "@/lib/server/audit";
import { acceptMessage, completeMessage, type BrainInput, type BrainResult } from "@/lib/server/bot/brain";
import { defaultGreeting, parseSoulExtras } from "@/lib/server/bot/prompt";
import { hashSender, ownerLinkCode, sameCode, telegramConversationId } from "@/lib/server/bot/secrets";
import { setTelegramOwnerChat, wipeTelegram, type BotRecord } from "@/lib/server/bot/store";
import {
  deleteWebhook,
  readCommand,
  sendMessage,
  sendTyping,
  type TelegramError,
  type TelegramMessage,
} from "@/lib/server/bot/telegram";
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

/** Повтор отправки ответа (аудит № 49): один раз, коротко, и только пока after() укладывается в 60 с. */
export const TELEGRAM_RETRY = {
  /** пауза перед повтором */
  delayMs: 1_500,
  /** таймаут повторной отправки (первая — обычные 8 с) */
  timeoutMs: 4_000,
  /** повторяем, только если с начала ответа прошло не больше — иначе не уложиться в maxDuration 60 с */
  maxElapsedMs: 48_000,
} as const;

const RETRYABLE: readonly TelegramError[] = ["timeout", "network", "server", "rate_limited"];

/**
 * Медленная часть: модель и ответ. Вызывать в after().
 * Звёзды списываются, когда модель ответила (до отправки): иначе ответ пришлось бы отдавать
 * до списания. Поэтому отправку проверяем: сбой сети или Telegram — один повтор; не доставили —
 * запись в журнал аудита с ключом списания (по нему админ вернёт звезду начислением).
 */
export async function runTelegramReply(
  bot: BotRecord,
  chatId: number,
  input: BrainInput,
  messageId: number,
  timing: { retryDelayMs?: number; now?: () => number } = {},
): Promise<void> {
  if (!bot.telegram.token) return;
  const now = timing.now ?? Date.now;
  const startedAt = now();
  const token = decryptSecret(bot.telegram.token);
  const typing = await sendTyping(token, chatId);
  // Токен отозван в @BotFather: ответ всё равно не доставить — модель не зовём, звёзды не тратим
  if (!typing.ok && typing.error === "unauthorized") {
    console.error("tg.reply: token rejected, reply skipped", { bot: bot.id });
    return;
  }
  let result: BrainResult;
  try {
    result = await completeMessage(input, messageId);
  } catch (error) {
    console.error("tg.reply: brain failed", { bot: bot.id, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    result = { status: "error", text: "Что-то сломалось. Попробуйте ещё раз чуть позже." };
  }
  const text = result.status === "ok" && result.lead === "saved" ? `${result.text}\n\n${TELEGRAM_TEXTS.leadSaved}` : result.text;
  if (!text) return;

  let sent = await sendMessage(token, chatId, text);
  if (!sent.ok && RETRYABLE.includes(sent.error) && now() - startedAt <= TELEGRAM_RETRY.maxElapsedMs) {
    await new Promise((resolve) => setTimeout(resolve, timing.retryDelayMs ?? TELEGRAM_RETRY.delayMs));
    sent = await sendMessage(token, chatId, text, TELEGRAM_RETRY.timeoutMs);
  }
  if (sent.ok) return;

  console.error("tg.reply: not delivered", { bot: bot.id, error: sent.error });
  if (result.status !== "ok") return;
  await audit({
    actorId: null,
    action: "bot.telegram_send_failed",
    targetUser: bot.ownerId,
    targetGroup: bot.owner.group?.id ?? null,
    // conversation — псевдоним чата (HMAC), сам chat id не пишем
    meta: { bot: bot.id, conversation: input.conversationId, chargeKey: input.chargeKey, stars: result.stars, error: sent.error },
  });
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
