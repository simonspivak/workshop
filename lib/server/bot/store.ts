import "server-only";
import { botLifetime, type BotLifetime } from "@/lib/server/bot/lifetime";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { readTools, type BotTools } from "@/lib/server/bot/tools";
import type { EncryptedSecret } from "@/lib/server/crypto";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { AgeBand, AppRole, BotChannel, Json } from "@/lib/server/supabase/types";

/*
  Доступ к таблицам ботов для сервера (admin-клиент, после проверки прав вызывающим кодом).
  Здесь нет решений «можно / нельзя» — только чтение и запись. Наружу (в браузер) эти записи
  не уходят: страницы получают DTO из lib/server/bot/dal.ts.
*/

export type BotOwner = {
  id: string;
  role: AppRole;
  ageBand: AgeBand;
  parentalConsent: boolean;
  disabled: boolean;
  nickname: string;
  group: { id: string; code: string; endsOn: string | null; paused: boolean; allowGoogleMinors: boolean } | null;
};

export type BotRecord = {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  soul: string;
  knowledge: string;
  tools: BotTools;
  avatarJobId: string | null;
  active: boolean;
  createdAt: string;
  telegram: {
    botId: number | null;
    username: string | null;
    token: EncryptedSecret | null;
    secretHash: string | null;
    ownerChatId: number | null;
    connectedAt: string | null;
  };
  owner: BotOwner;
};

const BOT_SELECT =
  "id, owner_id, slug, name, soul, knowledge, tools, avatar_job_id, active, created_at, " +
  "telegram_bot_id, telegram_bot_username, telegram_token_ciphertext, telegram_token_iv, telegram_token_tag, " +
  "telegram_webhook_secret_hash, telegram_owner_chat_id, telegram_connected_at, " +
  "owner:profiles!bots_owner_id_fkey(id, role, age_band, parental_consent_at, disabled, nickname, " +
  "group:groups!profiles_group_fk(id, code, ends_on, paused, allow_google_minors))";

type BotJoinRow = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  soul: string;
  knowledge: string;
  tools: Json;
  avatar_job_id: string | null;
  active: boolean;
  created_at: string;
  telegram_bot_id: number | null;
  telegram_bot_username: string | null;
  telegram_token_ciphertext: string | null;
  telegram_token_iv: string | null;
  telegram_token_tag: string | null;
  telegram_webhook_secret_hash: string | null;
  telegram_owner_chat_id: number | null;
  telegram_connected_at: string | null;
  owner: {
    id: string;
    role: AppRole;
    age_band: AgeBand;
    parental_consent_at: string | null;
    disabled: boolean;
    nickname: string;
    group: { id: string; code: string; ends_on: string | null; paused: boolean; allow_google_minors: boolean } | null;
  } | null;
};

function toRecord(row: BotJoinRow): BotRecord | null {
  if (!row.owner) return null;
  const token =
    row.telegram_token_ciphertext && row.telegram_token_iv && row.telegram_token_tag
      ? { ciphertext: row.telegram_token_ciphertext, iv: row.telegram_token_iv, tag: row.telegram_token_tag }
      : null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    name: row.name,
    soul: row.soul,
    knowledge: row.knowledge,
    tools: readTools(row.tools),
    avatarJobId: row.avatar_job_id,
    active: row.active,
    createdAt: row.created_at,
    telegram: {
      botId: row.telegram_bot_id,
      username: row.telegram_bot_username,
      token,
      secretHash: row.telegram_webhook_secret_hash,
      ownerChatId: row.telegram_owner_chat_id,
      connectedAt: row.telegram_connected_at,
    },
    owner: {
      id: row.owner.id,
      role: row.owner.role,
      ageBand: row.owner.age_band,
      parentalConsent: row.owner.parental_consent_at !== null,
      disabled: row.owner.disabled,
      nickname: row.owner.nickname,
      group: row.owner.group
        ? {
            id: row.owner.group.id,
            code: row.owner.group.code,
            endsOn: row.owner.group.ends_on,
            paused: row.owner.group.paused,
            allowGoogleMinors: row.owner.group.allow_google_minors,
          }
        : null,
    },
  };
}

async function loadBy(column: "id" | "slug" | "owner_id", value: string): Promise<BotRecord | null> {
  const { data, error } = await createAdminClient().from("bots").select(BOT_SELECT).eq(column, value).maybeSingle<BotJoinRow>();
  if (error) throw new Error(`bot.store.load failed (${error.code})`);
  return data ? toRecord(data) : null;
}

export const loadBotById = (id: string) => loadBy("id", id);
export const loadBotBySlug = (slug: string) => loadBy("slug", slug);
export const loadBotByOwner = (ownerId: string) => loadBy("owner_id", ownerId);

// ---------- правила владельца ----------

export function isStaffOwner(owner: Pick<BotOwner, "role">): boolean {
  return owner.role === "teacher" || owner.role === "admin";
}

/** Контакт в заявке и Telegram — только 18+ и ведущим. */
export function isAdultOwner(owner: Pick<BotOwner, "role" | "ageBand">): boolean {
  return isStaffOwner(owner) || owner.ageBand === "adult";
}

export function lifetimeOf(bot: Pick<BotRecord, "owner">, now = new Date()): BotLifetime {
  return botLifetime({ role: bot.owner.role, endsOn: bot.owner.group?.endsOn ?? null }, now);
}

/** Субъект для prices.canUse (роль, возраст, согласие, группа). */
export function priceSubject(owner: BotOwner) {
  return {
    role: owner.role,
    ageBand: owner.ageBand,
    parentalConsent: owner.parentalConsent,
    group: owner.group
      ? {
          id: owner.group.id,
          code: owner.group.code,
          title: "",
          paused: owner.group.paused,
          allowGoogleMinors: owner.group.allowGoogleMinors,
          shareGallery: false,
          endsOn: owner.group.endsOn,
        }
      : null,
  };
}

// ---------- сообщения ----------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const since = (ms: number) => new Date(Date.now() - ms).toISOString();

export type InsertMessageResult = { id: number } | "duplicate" | "sender_hour" | "bot_day";

export type MessageRow = {
  botId: string;
  channel: BotChannel;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  senderHash?: string | null;
  telegramUpdateId?: number | null;
  stars?: number;
  /** ключ входящего сообщения (bot:<бот>:<id> или tg:<бот>:<update_id>): повтор не записывается */
  dedupeKey?: string | null;
  /** лимиты гостя: проверяются и пишутся одной транзакцией (insert_bot_message) */
  limits?: { senderPerHour: number; botPerDay: number } | null;
};

/**
 * Сохранить сообщение. 'duplicate' — повтор того же сообщения (update_id Telegram или dedupeKey);
 * 'sender_hour' / 'bot_day' — сообщение гостя сверх лимита, оно не записано.
 * Лимиты и запись — одна SQL-функция под блокировкой: параллельные запросы не проходят лимит все сразу.
 */
export async function insertMessage(row: MessageRow): Promise<InsertMessageResult> {
  const { data, error } = await createAdminClient().rpc("insert_bot_message", {
    p_bot: row.botId,
    p_channel: row.channel,
    p_conversation_id: row.conversationId,
    p_role: row.role,
    p_content: row.content.slice(0, 4000),
    p_ip_hash: row.senderHash ?? null,
    p_telegram_update_id: row.telegramUpdateId ?? null,
    p_stars: row.stars ?? 0,
    p_dedupe_key: row.dedupeKey ?? null,
    p_sender_per_hour: row.limits && row.senderHash ? row.limits.senderPerHour : null,
    p_bot_per_day: row.limits ? row.limits.botPerDay : null,
  });
  // Код вышел раньше миграции 20261105100000 (функции ещё нет): пишем по-старому
  if (error && (error.code === "PGRST202" || error.code === "42883")) return insertMessageDirect(row);
  const result = data?.[0];
  if (error || !result) throw new Error(`bot.store.insertMessage failed (${error?.code})`);
  if (result.outcome === "accepted" && result.message_id != null) return { id: result.message_id };
  if (result.outcome === "duplicate" || result.outcome === "sender_hour" || result.outcome === "bot_day") return result.outcome;
  throw new Error("bot.store.insertMessage: unexpected result");
}

async function insertMessageDirect(row: MessageRow): Promise<{ id: number } | "duplicate"> {
  const { data, error } = await createAdminClient()
    .from("bot_messages")
    .insert({
      bot_id: row.botId,
      channel: row.channel,
      conversation_id: row.conversationId,
      role: row.role,
      content: row.content.slice(0, 4000),
      ip_hash: row.senderHash ?? null,
      telegram_update_id: row.telegramUpdateId ?? null,
      stars: row.stars ?? 0,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`bot.store.insertMessage failed (${error?.code})`);
  return { id: data.id };
}

/** Метка для сообщений, которые не прошли модерацию: в историю модели они не попадают. */
export const HIDDEN_MESSAGE = "[сообщение скрыто]";

/** Последние сообщения диалога, от старых к новым. beforeId — не включать это и более новые. */
export async function loadHistory(
  botId: string,
  conversationId: string,
  options: { beforeId?: number; limit?: number } = {},
): Promise<{ id: number; role: "user" | "assistant"; content: string; createdAt: string }[]> {
  let query = createAdminClient()
    .from("bot_messages")
    .select("id, role, content, created_at")
    .eq("bot_id", botId)
    .eq("conversation_id", conversationId)
    .neq("content", HIDDEN_MESSAGE)
    .order("id", { ascending: false })
    .limit(options.limit ?? BOT_LIMITS.historyMessages);
  if (options.beforeId) query = query.lt("id", options.beforeId);
  const { data, error } = await query;
  if (error) throw new Error(`bot.store.loadHistory failed (${error.code})`);
  return (data ?? [])
    .reverse()
    .map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at }));
}

/** Сколько сообщений гостей: с этого IP/чата за час (на все боты) и у бота за сутки (без проверки владельца). */
export async function countRecent(input: {
  botId: string;
  senderHash: string | null;
  previewPrefix: string;
}): Promise<{ senderLastHour: number | null; botLastDay: number }> {
  const db = createAdminClient();
  const [sender, bot] = await Promise.all([
    input.senderHash
      ? db
          .from("bot_messages")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", input.senderHash)
          .eq("role", "user")
          .gte("created_at", since(HOUR_MS))
      : Promise.resolve(null),
    db
      .from("bot_messages")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", input.botId)
      .eq("role", "user")
      .not("conversation_id", "like", `${input.previewPrefix}%`)
      .gte("created_at", since(DAY_MS)),
  ]);
  if (sender?.error) throw new Error(`bot.store.countRecent sender failed (${sender.error.code})`);
  if (bot.error) throw new Error(`bot.store.countRecent bot failed (${bot.error.code})`);
  return { senderLastHour: sender ? (sender.count ?? 0) : null, botLastDay: bot.count ?? 0 };
}

export async function deleteConversation(botId: string, conversationId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("bot_messages")
    .delete()
    .eq("bot_id", botId)
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`bot.store.deleteConversation failed (${error.code})`);
}

// ---------- звёзды владельца ----------

/** Можно ли сейчас списать звёзды владельца (быстрая проверка до вызова модели). */
export async function ownerSpendState(owner: BotOwner): Promise<{ balance: number; generationEnabled: boolean }> {
  const db = createAdminClient();
  const [wallet, setting] = await Promise.all([
    db.from("wallets").select("balance").eq("user_id", owner.id).maybeSingle(),
    db.from("settings").select("value").eq("key", "generation_enabled").maybeSingle(),
  ]);
  if (wallet.error) throw new Error(`bot.store.ownerSpendState wallet failed (${wallet.error.code})`);
  const enabled = setting.data?.value;
  return { balance: wallet.data?.balance ?? 0, generationEnabled: enabled !== false && enabled !== "false" };
}

/** Есть ли уже списание с этим ключом (повтор того же сообщения). */
export async function alreadyCharged(ownerId: string, idempotencyKey: string): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from("star_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw new Error(`bot.store.alreadyCharged failed (${error.code})`);
  return (count ?? 0) > 0;
}

// ---------- заявки (бот только пишет) ----------

export async function countLeads(botId: string, conversationId: string): Promise<{ botDay: number; conversationDay: number }> {
  const db = createAdminClient();
  const from = since(DAY_MS);
  const [bot, conversation] = await Promise.all([
    db.from("bot_leads").select("id", { count: "exact", head: true }).eq("bot_id", botId).gte("created_at", from),
    db
      .from("bot_leads")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .eq("conversation_id", conversationId)
      .gte("created_at", from),
  ]);
  if (bot.error || conversation.error) throw new Error("bot.store.countLeads failed");
  return { botDay: bot.count ?? 0, conversationDay: conversation.count ?? 0 };
}

export async function insertLead(row: {
  botId: string;
  channel: BotChannel;
  conversationId: string;
  data: Record<string, string | number>;
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("bot_leads")
    .insert({ bot_id: row.botId, channel: row.channel, conversation_id: row.conversationId, data: row.data })
    .select("id")
    .single();
  if (error || !data) throw new Error(`bot.store.insertLead failed (${error?.code})`);
  return data.id;
}

export async function markLeadNotified(leadId: string): Promise<void> {
  await createAdminClient().from("bot_leads").update({ notified_at: new Date().toISOString() }).eq("id", leadId);
}

// ---------- Telegram ----------

export async function saveTelegramConnection(
  botId: string,
  input: { telegramBotId: number; username: string; token: EncryptedSecret; secretHash: string },
): Promise<{ connectedAt: string } | "taken"> {
  const connectedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("bots")
    .update({
      telegram_bot_id: input.telegramBotId,
      telegram_bot_username: input.username,
      telegram_token_ciphertext: input.token.ciphertext,
      telegram_token_iv: input.token.iv,
      telegram_token_tag: input.token.tag,
      telegram_webhook_secret_hash: input.secretHash,
      telegram_owner_chat_id: null,
      telegram_connected_at: connectedAt,
      telegram_disconnected_at: null,
    })
    .eq("id", botId);
  if (error?.code === "23505") return "taken";
  if (error) throw new Error(`bot.store.saveTelegramConnection failed (${error.code})`);
  return { connectedAt };
}

/** Стереть токен, хеш секрета и чат владельца. Имя бота в Telegram оставляем для истории. */
export async function wipeTelegram(botId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("bots")
    .update({
      telegram_bot_id: null,
      telegram_token_ciphertext: null,
      telegram_token_iv: null,
      telegram_token_tag: null,
      telegram_webhook_secret_hash: null,
      telegram_owner_chat_id: null,
      telegram_disconnected_at: new Date().toISOString(),
    })
    .eq("id", botId);
  if (error) throw new Error(`bot.store.wipeTelegram failed (${error.code})`);
}

export async function setTelegramOwnerChat(botId: string, chatId: number): Promise<void> {
  const { error } = await createAdminClient().from("bots").update({ telegram_owner_chat_id: chatId }).eq("id", botId);
  if (error) throw new Error(`bot.store.setTelegramOwnerChat failed (${error.code})`);
}
