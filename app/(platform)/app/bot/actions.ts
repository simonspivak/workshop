"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { handleMessage } from "@/lib/server/bot/brain";
import { startCard } from "@/lib/server/bot/card";
import { toChatReply, type CardStartReply, type ChatReply } from "@/lib/server/bot/chat";
import { botFail, botFailFromError, type BotActionResult } from "@/lib/server/bot/errors";
import { guardOwnerText } from "@/lib/server/bot/guard";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { previewConversationId } from "@/lib/server/bot/secrets";
import { normalizeSlug, slugCandidates, slugify } from "@/lib/server/bot/slug";
import {
  deleteConversation,
  isAdultOwner,
  lifetimeOf,
  loadBotByOwner,
  saveTelegramConnection,
  wipeTelegram,
  type BotRecord,
} from "@/lib/server/bot/store";
import { deleteWebhook, getMe, setWebhook, TELEGRAM_TOKEN_RE } from "@/lib/server/bot/telegram";
import { checkToolsForOwner, leadFormSchema, type BotTools, type LeadForm } from "@/lib/server/bot/tools";
import { decryptSecret, encryptSecret, randomSecret, sha256Hex } from "@/lib/server/crypto";
import { authorize, type SessionUser } from "@/lib/server/dal/auth";
import { appUrl } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { Json } from "@/lib/server/supabase/types";

/*
  Мутации «Моего бота». Каждая Action сама проверяет вход (authorize), берёт бота только по
  owner_id = текущий пользователь (id бота от клиента не принимаем), валидирует вход zod,
  модерирует тексты владельца и пишет audit_log. Писать может только admin-клиент.
*/

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
// textarea отправляет переводы строк как \r\n: считаем длину после нормализации, как в базе
const multiline = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : ""), z.string().max(max));

function invalid(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message || "Проверьте это поле.";
  return botFail("invalid_input", fields);
}

async function myBot(user: SessionUser): Promise<BotRecord | null> {
  return loadBotByOwner(user.id);
}

/** Проверить тексты владельца. Возвращает ошибку поля или null. */
async function moderateOwnerFields(
  user: SessionUser,
  adult: boolean,
  fields: Record<string, string>,
): Promise<BotActionResult | null> {
  for (const [field, value] of Object.entries(fields)) {
    const result = guardOwnerText(value, { adult, maxLength: BOT_LIMITS.knowledgeMax + 100 });
    if (!result.ok) {
      await audit({
        actorId: user.id,
        action: "moderation.blocked",
        targetUser: user.id,
        targetGroup: user.group?.id,
        meta: { source: "bot", field, reason: result.reason },
      });
      // В характере стоп-слова чаще всего — список запретов: подсказываем, что правила платформы его уже содержат
      const code = result.reason === "stop_word" ? "owner_stop_word" : result.reason;
      return botFail(code, { [field]: botFail(code).message });
    }
  }
  return null;
}

// ---------- создание ----------

const createSchema = z.object({ name: z.string().trim().min(1, "Назовите бота.").max(BOT_LIMITS.nameMax) });

export async function createBot(_prev: BotActionResult | null, formData: FormData): Promise<BotActionResult> {
  try {
    const user = await authorize();
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    if (await myBot(user)) {
      refresh();
      return { ok: true };
    }
    const adult = user.role !== "student" || user.ageBand === "adult";
    const blocked = await moderateOwnerFields(user, adult, { name: parsed.data.name });
    if (blocked) return blocked;

    const db = createAdminClient();
    for (const slug of slugCandidates(slugify(parsed.data.name))) {
      const { data, error } = await db
        .from("bots")
        .insert({ owner_id: user.id, slug, name: parsed.data.name })
        .select("id")
        .single();
      if (!error && data) {
        await audit({ actorId: user.id, action: "bot.create", targetUser: user.id, targetGroup: user.group?.id, meta: { bot: data.id, slug } });
        refresh();
        return { ok: true };
      }
      if (error?.code !== "23505") throw new Error(`insert bot failed (${error?.code})`);
      // занят owner_id (второй клик) — бот уже есть
      if (await myBot(user)) {
        refresh();
        return { ok: true };
      }
    }
    return botFail("slug_taken");
  } catch (error) {
    return botFailFromError(error, "createBot");
  }
}

// ---------- настройки ----------

const saveSchema = z.object({
  name: z.string().trim().min(1, "Назовите бота.").max(BOT_LIMITS.nameMax),
  slug: z.string().trim().max(80).default(""),
  soul: multiline(BOT_LIMITS.soulMax),
  knowledge: multiline(BOT_LIMITS.knowledgeMax),
  toolLeads: checkbox,
  toolImage: checkbox,
  toolKnowledge: checkbox,
  leadForm: z.string().max(8000).default(""),
  avatarJobId: z.union([z.literal(""), z.uuid()]).default(""),
});

function parseLeadForm(raw: string): { form: LeadForm | null; error: string | null } {
  if (!raw.trim()) return { form: null, error: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { form: null, error: "Не получилось прочитать форму заявки." };
  }
  const parsed = leadFormSchema.safeParse(json);
  if (!parsed.success) return { form: null, error: parsed.error.issues[0]?.message || "Проверьте поля формы заявки." };
  return { form: parsed.data, error: null };
}

async function avatarAllowed(userId: string, jobId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("jobs")
    .select("id, status, action, storage_path, hidden")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(
    data && data.status === "done" && !data.hidden && data.storage_path && (data.action === "image" || data.action === "image_edit"),
  );
}

export async function saveBot(_prev: BotActionResult | null, formData: FormData): Promise<BotActionResult> {
  try {
    const user = await authorize();
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    if (lifetimeOf(bot).retired) return botFail("bot_retired");

    const parsed = saveSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    const adult = isAdultOwner(bot.owner);

    const lead = parseLeadForm(input.leadForm);
    if (lead.error && input.toolLeads) return botFail("invalid_input", { leadForm: lead.error });
    const tools: BotTools = {
      leads: input.toolLeads,
      image: input.toolImage,
      knowledge: input.toolKnowledge,
      leadForm: lead.form,
    };
    const toolsProblem = checkToolsForOwner(tools, { allowContact: adult });
    if (toolsProblem) return botFail(toolsProblem, { leadForm: botFail(toolsProblem).message });

    const formText = tools.leadForm
      ? [tools.leadForm.title, ...tools.leadForm.fields.flatMap((f) => [f.label, ...(f.options ?? [])])].join("\n")
      : "";
    const blocked = await moderateOwnerFields(user, adult, {
      name: input.name,
      soul: input.soul,
      knowledge: input.knowledge,
      leadForm: formText,
    });
    if (blocked) return blocked;

    let slug = bot.slug;
    if (input.slug && input.slug !== bot.slug) {
      const normalized = normalizeSlug(input.slug);
      if (!normalized) return botFail("slug_invalid", { slug: botFail("slug_invalid").message });
      slug = normalized;
    }

    if (input.avatarJobId && !(await avatarAllowed(user.id, input.avatarJobId))) {
      return botFail("avatar_invalid", { avatarJobId: botFail("avatar_invalid").message });
    }

    const { error } = await createAdminClient()
      .from("bots")
      .update({
        name: input.name,
        slug,
        soul: input.soul.trim(),
        knowledge: input.knowledge.trim(),
        tools: tools as unknown as Json,
        avatar_job_id: input.avatarJobId || null,
      })
      .eq("id", bot.id)
      .eq("owner_id", user.id);
    if (error?.code === "23505") return botFail("slug_taken", { slug: botFail("slug_taken").message });
    if (error) throw new Error(`update bot failed (${error.code})`);

    await audit({
      actorId: user.id,
      action: "bot.update",
      targetUser: user.id,
      targetGroup: user.group?.id,
      meta: {
        bot: bot.id,
        slug,
        soulLength: input.soul.length,
        knowledgeLength: input.knowledge.length,
        tools: { leads: tools.leads, image: tools.image, knowledge: tools.knowledge },
        leadFields: tools.leadForm?.fields.map((f) => f.type) ?? [],
      },
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return botFailFromError(error, "saveBot");
  }
}

// ---------- проверка в конструкторе (тот же мозг, звёзды владельца) ----------

const previewSchema = z.object({
  text: z.string().trim().min(1).max(BOT_LIMITS.messageMax),
  messageId: z.uuid(),
});

export async function sendPreviewMessage(input: { text: string; messageId: string }): Promise<ChatReply> {
  try {
    const user = await authorize();
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return botFail("invalid_input");
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    const conversationId = previewConversationId(user.id);
    const result = await handleMessage({
      bot,
      channel: "web",
      conversationId,
      preview: true,
      text: parsed.data.text,
      chargeKey: `bot:${bot.id}:${parsed.data.messageId}`,
      senderHash: null,
    });
    return toChatReply(result, { botId: bot.id, conversationId });
  } catch (error) {
    return botFailFromError(error, "sendPreviewMessage");
  }
}

export async function resetPreview(): Promise<BotActionResult> {
  try {
    const user = await authorize();
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    await deleteConversation(bot.id, previewConversationId(user.id));
    return { ok: true };
  } catch (error) {
    return botFailFromError(error, "resetPreview");
  }
}

export async function startPreviewCard(input: { ticket: string }): Promise<CardStartReply> {
  try {
    const user = await authorize();
    const ticket = z.string().min(10).max(2000).safeParse(input?.ticket);
    if (!ticket.success) return botFail("card_ticket");
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    const result = await startCard({ bot, conversationId: previewConversationId(user.id), preview: true, ticket: ticket.data });
    return result.ok ? result : botFail(result.error);
  } catch (error) {
    return botFailFromError(error, "startPreviewCard");
  }
}

// ---------- Telegram (только 18+ и ведущие) ----------

const tokenSchema = z.object({ token: z.string().trim().regex(TELEGRAM_TOKEN_RE) });

export async function connectTelegram(_prev: BotActionResult | null, formData: FormData): Promise<BotActionResult> {
  try {
    const user = await authorize();
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    if (lifetimeOf(bot).retired) return botFail("bot_retired");
    if (!isAdultOwner(bot.owner)) return botFail("telegram_adult_only");

    const parsed = tokenSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return botFail("telegram_token_invalid", { token: botFail("telegram_token_invalid").message });
    const token = parsed.data.token;

    const base = appUrl();
    if (!base) return botFail("app_url_missing");

    const me = await getMe(token);
    if (!me.ok) return botFail(me.error === "unauthorized" ? "telegram_token_invalid" : "telegram_failed");
    if (!me.result.is_bot || !me.result.username) return botFail("telegram_token_invalid");

    // Был другой токен — снимаем его вебхук (если токен тот же, setWebhook ниже его заменит)
    if (bot.telegram.token && bot.telegram.botId !== me.result.id) {
      await deleteWebhook(decryptSecret(bot.telegram.token)).catch(() => undefined);
    }

    const secret = randomSecret(32);
    const saved = await saveTelegramConnection(bot.id, {
      telegramBotId: me.result.id,
      username: me.result.username,
      token: encryptSecret(token),
      secretHash: sha256Hex(secret),
    });
    if (saved === "taken") return botFail("telegram_taken");

    const hook = await setWebhook(token, { url: `${base}/api/tg/${bot.id}`, secretToken: secret });
    if (!hook.ok) {
      await wipeTelegram(bot.id);
      return botFail(hook.error === "unauthorized" ? "telegram_token_invalid" : "telegram_failed");
    }

    await audit({
      actorId: user.id,
      action: "bot.telegram_connect",
      targetUser: user.id,
      targetGroup: user.group?.id,
      meta: { bot: bot.id, username: me.result.username },
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return botFailFromError(error, "connectTelegram");
  }
}

// Вызывается из useActionState(prev, formData): аргументы не нужны
export async function disconnectTelegram(): Promise<BotActionResult> {
  try {
    const user = await authorize();
    const bot = await myBot(user);
    if (!bot) return botFail("bot_missing");
    if (bot.telegram.token) {
      // Не вышло снять вебхук — всё равно стираем токен: вебхук без секрета получит 401
      const removed = await deleteWebhook(decryptSecret(bot.telegram.token)).catch(() => null);
      if (!removed?.ok) console.error("bot.disconnectTelegram: deleteWebhook failed", { bot: bot.id });
    }
    await wipeTelegram(bot.id);
    await audit({
      actorId: user.id,
      action: "bot.telegram_disconnect",
      targetUser: user.id,
      targetGroup: user.group?.id,
      meta: { bot: bot.id, username: bot.telegram.username },
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return botFailFromError(error, "disconnectTelegram");
  }
}
