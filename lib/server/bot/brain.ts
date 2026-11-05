import "server-only";
import { after } from "next/server";
import { guardReply, guardText, guestBlockedText, hasPersonalData } from "@/lib/server/bot/guard";
import { extractServiceLines, readCardScene, validateLead, type LeadData } from "@/lib/server/bot/leads";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { buildConversationPrompt, buildSystemPrompt, leaksInstructions, sanitizeGuestText } from "@/lib/server/bot/prompt";
import { rateLimitDecision, type RateLimitHit } from "@/lib/server/bot/ratelimit";
import { PREVIEW_PREFIX } from "@/lib/server/bot/secrets";
import {
  HIDDEN_MESSAGE,
  alreadyCharged,
  countLeads,
  countRecent,
  insertLead,
  insertMessage,
  isAdultOwner,
  isStaffOwner,
  lifetimeOf,
  loadHistory,
  markLeadNotified,
  ownerSpendState,
  priceSubject,
  type BotRecord,
} from "@/lib/server/bot/store";
import { sendMessage } from "@/lib/server/bot/telegram";
import { decryptSecret } from "@/lib/server/crypto";
import { appUrl } from "@/lib/server/env";
import { generateText, isMockMode } from "@/lib/server/gateway";
import { moderateText } from "@/lib/server/moderation";
import { canUse } from "@/lib/server/prices";
import type { BotChannel } from "@/lib/server/supabase/types";
import { spendStars } from "@/lib/server/wallet";

/*
  Мозг бота (docs/platform/spec.md §5). Один для веб-чата, проверки в конструкторе и Telegram.

  Порядок:
    1. Срок жизни и «снят с публикации» → «бот переехал».
    2. Модерация сообщения гостя (стоп-слова; у ботов 14–17 — без телефонов и e-mail).
    3. Лимиты: 30 сообщений в час с IP/чата, 200 сообщений гостей в сутки на бота.
    4. Сообщение сохраняется (в Telegram уникальный update_id отсекает повторы).
    5. Звёзды владельца: если кончились или группа на паузе — «бот отдыхает», модель не зовём.
    6. Промпт: правила + душа + инструменты + знания + последние 10 сообщений → шлюз (claude-haiku-5-5).
    7. Списание 1★ с ключом идемпотентности входящего сообщения (повтор не списывает).
    8. Служебные строки [[ЗАЯВКА]] / [[ОТКРЫТКА]] вырезаются; заявка проверяется по форме и
       пишется в bot_leads (бот её прочитать не может). Ответ проверяется на утечку души.
  Ведущие и админы отвечают бесплатно (демо-режим), но с журналом сообщений.
*/

export type LeadOutcome = "saved" | "invalid" | "limit" | null;

export type BrainResult =
  | {
      status: "ok";
      text: string;
      stars: number;
      lead: LeadOutcome;
      /** гость согласился на открытку: платформа покажет кнопку с ценой */
      card: { scene: string; stars: number } | null;
    }
  | { status: "blocked" | "limited" | "resting" | "retired" | "duplicate" | "error"; text: string };

export type BrainInput = {
  bot: BotRecord;
  channel: BotChannel;
  conversationId: string;
  /** проверка владельцем в конструкторе: без лимитов гостей, открытки разрешены */
  preview: boolean;
  text: string;
  /** ключ списания: bot:<botId>:<id сообщения> или tg:<botId>:<update_id> (8–100 символов) */
  chargeKey: string;
  /** хеш IP или chat id (лимит в час); null — проверка владельцем */
  senderHash: string | null;
  telegramUpdateId?: number | null;
};

export const BOT_TEXTS = {
  retired: "Бот переехал: курс закончился, здесь он больше не отвечает.",
  resting: "Бот отдыхает и скоро вернётся.",
  limitedSender: "Слишком много сообщений подряд. Передохните и напишите через час.",
  limitedBot: "Бот сегодня уже много разговаривал и отдыхает до завтра.",
  error: "Что-то сломалось. Попробуйте ещё раз чуть позже.",
  neutral: "Давайте поговорим о чём-нибудь другом.",
  secret: "Это мой маленький секрет. Давайте лучше о другом.",
  leadInvalid: "(Заявка не сохранилась: не хватает данных. Давайте проверим ещё раз.)",
  leadLimit: "(Заявок на сегодня уже много. Попробуйте завтра.)",
} as const;

const RESTING_FOR_OWNER = {
  insufficient_stars: "Бот отдыхает: у вас закончились звёзды. Попросите ведущего начислить.",
  group_paused: "Бот отдыхает: ведущий поставил группу на паузу.",
  generation_disabled: "Бот отдыхает: генерации временно выключены.",
  user_disabled: "Бот отдыхает: аккаунт отключён.",
} as const;

type RestingReason = keyof typeof RESTING_FOR_OWNER;

function resting(input: BrainInput, reason: RestingReason): BrainResult {
  return { status: "resting", text: input.preview ? RESTING_FOR_OWNER[reason] : BOT_TEXTS.resting };
}

/** Открытку можно предложить: инструмент включён, не Telegram; гостям — только у ботов 18+. */
export function cardsAvailable(bot: BotRecord, channel: BotChannel, preview: boolean): boolean {
  if (!bot.tools.image || channel === "telegram") return false;
  return preview || isAdultOwner(bot.owner);
}

// ---------- шаг 1–4: принять сообщение ----------

export async function acceptMessage(input: BrainInput): Promise<{ status: "accepted"; messageId: number } | BrainResult> {
  const { bot } = input;
  if (!bot.active || lifetimeOf(bot).retired) return { status: "retired", text: BOT_TEXTS.retired };

  const text = input.text.trim();
  const guard = guardText(text, { allowContacts: isAdultOwner(bot.owner), maxLength: BOT_LIMITS.messageMax });
  if (!guard.ok) {
    // В Telegram запоминаем update_id даже у скрытого сообщения: повтор не обработается дважды
    if (input.telegramUpdateId != null) {
      const stored = await insertMessage({
        botId: bot.id,
        channel: input.channel,
        conversationId: input.conversationId,
        role: "user",
        content: HIDDEN_MESSAGE,
        senderHash: input.senderHash,
        telegramUpdateId: input.telegramUpdateId,
      });
      if (stored === "duplicate") return { status: "duplicate", text: "" };
    }
    return { status: "blocked", text: guestBlockedText(guard.reason) };
  }

  const limited = (hit: RateLimitHit): BrainResult => ({
    status: "limited",
    text: hit === "sender_hour" ? BOT_TEXTS.limitedSender : BOT_TEXTS.limitedBot,
  });

  // Быстрая проверка без блокировок; окончательная — при записи (insert_bot_message)
  if (!input.preview) {
    const hit = rateLimitDecision(
      await countRecent({ botId: bot.id, senderHash: input.senderHash, previewPrefix: PREVIEW_PREFIX }),
    );
    if (hit) return limited(hit);
  }

  // Повтор того же сообщения из браузера (двойной клик, повтор запроса): уже списано — не отвечаем второй раз
  if (input.telegramUpdateId == null && !isStaffOwner(bot.owner) && (await alreadyCharged(bot.ownerId, input.chargeKey))) {
    return { status: "duplicate", text: "" };
  }

  // Лимиты и запись — одной транзакцией: параллельные запросы не проходят лимит все сразу,
  // а одно и то же сообщение (chargeKey) записывается и доходит до модели только один раз
  const stored = await insertMessage({
    botId: bot.id,
    channel: input.channel,
    conversationId: input.conversationId,
    role: "user",
    content: text,
    senderHash: input.senderHash,
    telegramUpdateId: input.telegramUpdateId ?? null,
    dedupeKey: input.chargeKey,
    limits: input.preview ? null : { senderPerHour: BOT_LIMITS.senderPerHour, botPerDay: BOT_LIMITS.botPerDay },
  });
  if (stored === "duplicate") return { status: "duplicate", text: "" };
  if (stored === "sender_hour" || stored === "bot_day") return limited(stored);
  return { status: "accepted", messageId: stored.id };
}

// ---------- шаг 5–8: ответить ----------

export async function completeMessage(input: BrainInput, messageId: number): Promise<BrainResult> {
  const { bot } = input;
  const owner = bot.owner;
  const adult = isAdultOwner(owner);

  // Цена ответа — из прайса (bot_reply). Ведущим и админам — 0.
  const price = await canUse(priceSubject(owner), "bot_reply");
  if (!price.ok) return resting(input, "generation_disabled");
  const stars = price.stars;

  if (owner.disabled) return resting(input, "user_disabled");
  if (stars > 0) {
    if (owner.group?.paused) return resting(input, "group_paused");
    const state = await ownerSpendState(owner);
    if (!state.generationEnabled) return resting(input, "generation_disabled");
    if (state.balance < stars) return resting(input, "insufficient_stars");
  }

  const history = await loadHistory(bot.id, input.conversationId, { beforeId: messageId });
  const canCard = cardsAvailable(bot, input.channel, input.preview);
  const system = buildSystemPrompt(bot, {
    channel: input.channel,
    cardsAvailable: canCard,
    allowContact: adult,
    webUrl: appUrl() ? `${appUrl()}/b/${bot.slug}` : null,
  });
  const mock = isMockMode();
  const prompt = mock
    ? sanitizeGuestText(input.text)
    : buildConversationPrompt(bot.name, history.map(({ role, content }) => ({ role, content })), input.text);

  const result = await generateText({ model: BOT_LIMITS.model, system, prompt, maxTokens: BOT_LIMITS.replyMaxTokens });
  if (!result.ok) {
    console.error("bot.brain: gateway failed", { bot: bot.id, error: result.error.slice(0, 80) });
    return { status: "error", text: BOT_TEXTS.error };
  }

  if (stars > 0) {
    const charge = await spendStars({
      userId: owner.id,
      amount: stars,
      reason: "bot_reply",
      idempotencyKey: input.chargeKey,
      ref: `bot:${bot.id}`,
    });
    if (!charge.ok) {
      if (
        charge.error === "insufficient_stars" ||
        charge.error === "group_paused" ||
        charge.error === "generation_disabled" ||
        charge.error === "user_disabled"
      ) {
        return resting(input, charge.error);
      }
      return { status: "error", text: BOT_TEXTS.error };
    }
  }

  const raw = mock ? withMockServiceLines(result.text, input.text) : result.text;
  const parsed = extractServiceLines(raw);
  let text = parsed.text || "…";

  // Защита от утечки души и постмодерация ответа
  if (leaksInstructions(text, bot.soul)) text = BOT_TEXTS.secret;
  else if (!guardReply(text, { adult })) text = BOT_TEXTS.neutral;

  // Заявка: только запись
  let lead: LeadOutcome = null;
  if (parsed.lead !== undefined && bot.tools.leads && bot.tools.leadForm) {
    const validation = validateLead(bot.tools.leadForm, parsed.lead, {
      allowContact: adult,
      hasPersonalData: adult ? undefined : hasPersonalData,
    });
    if (!validation.ok) {
      lead = "invalid";
    } else {
      const counts = await countLeads(bot.id, input.conversationId);
      if (
        counts.botDay >= BOT_LIMITS.leadsPerBotPerDay ||
        counts.conversationDay >= BOT_LIMITS.leadsPerConversationPerDay
      ) {
        lead = "limit";
      } else {
        const leadId = await insertLead({
          botId: bot.id,
          channel: input.channel,
          conversationId: input.conversationId,
          data: validation.data,
        });
        lead = "saved";
        after(() => notifyOwner(bot, leadId, validation.data, input.channel));
      }
    }
  }
  if (lead === "invalid") text = `${text}\n\n${BOT_TEXTS.leadInvalid}`;
  if (lead === "limit") text = `${text}\n\n${BOT_TEXTS.leadLimit}`;

  // Открытка: только предложение. Звёзды спишутся, когда гость нажмёт кнопку
  let card: { scene: string; stars: number } | null = null;
  if (parsed.card !== undefined && canCard) {
    const scene = readCardScene(parsed.card);
    if (scene && moderateText(scene, { maxLength: 200 }).ok) {
      const decision = await canUse(priceSubject(owner), bot.avatarJobId ? "image_edit" : "image");
      if (decision.ok) card = { scene, stars: decision.stars };
    }
  }

  await insertMessage({
    botId: bot.id,
    channel: input.channel,
    conversationId: input.conversationId,
    role: "assistant",
    content: text,
    stars,
  });
  return { status: "ok", text, stars, lead, card };
}

export async function handleMessage(input: BrainInput): Promise<BrainResult> {
  const accepted = await acceptMessage(input);
  if (accepted.status !== "accepted") return accepted;
  return completeMessage(input, accepted.messageId);
}

// ---------- уведомление владельцу ----------

const CHANNEL_LABELS: Record<BotChannel, string> = { web: "страница бота", telegram: "Telegram" };

async function notifyOwner(bot: BotRecord, leadId: string, data: LeadData, channel: BotChannel): Promise<void> {
  if (!bot.telegram.token || !bot.telegram.ownerChatId) return;
  try {
    const lines = Object.entries(data).map(([key, value]) => `${key}: ${value}`);
    const text = [
      `Новая заявка — бот «${bot.name}»${bot.tools.leadForm ? `, форма «${bot.tools.leadForm.title}»` : ""}`,
      ...lines,
      `Откуда: ${CHANNEL_LABELS[channel]}`,
    ].join("\n");
    const sent = await sendMessage(decryptSecret(bot.telegram.token), bot.telegram.ownerChatId, text);
    if (sent.ok) await markLeadNotified(leadId);
  } catch (error) {
    console.error("bot.brain: notify failed", { bot: bot.id, error: error instanceof Error ? error.name : "unknown" });
  }
}

// ---------- mock-режим ----------
// Без шлюза модель не вызывается. Чтобы проверить заявки и открытки в Preview, гость пишет
// [[mock-lead]]{"Имя":"Гость"} или [[mock-card]] — к тестовому ответу добавится служебная строка.

function withMockServiceLines(reply: string, guestText: string): string {
  const lead = /^\s*\[\[mock-lead\]\]\s*(\{[\s\S]*\})\s*$/i.exec(guestText);
  if (lead) return `${reply}\n[[ЗАЯВКА]]${lead[1]}`;
  if (/^\s*\[\[mock-card\]\]/i.test(guestText)) return `${reply}\n[[ОТКРЫТКА]]{"scene":"машет лапкой на краю сковородки"}`;
  return reply;
}
