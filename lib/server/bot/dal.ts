import "server-only";
import { avatarPath, signedMediaUrl } from "@/lib/server/bot/card";
import type { BotLifetime } from "@/lib/server/bot/lifetime";
import { defaultGreeting, parseSoulExtras } from "@/lib/server/bot/prompt";
import { ownerLinkCode, previewConversationId, webConversationId } from "@/lib/server/bot/secrets";
import { cardsAvailable } from "@/lib/server/bot/brain";
import {
  HIDDEN_MESSAGE,
  isAdultOwner,
  lifetimeOf,
  loadBotByOwner,
  loadBotBySlug,
  loadHistory,
  priceSubject,
  type BotRecord,
} from "@/lib/server/bot/store";
import type { BotTools, LeadForm } from "@/lib/server/bot/tools";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { getGroup } from "@/lib/server/dal/teacher";
import { canUse } from "@/lib/server/prices";
import { signMediaPaths } from "@/lib/server/storage";
import { fetchAll } from "@/lib/server/supabase/paging";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { AgeBand } from "@/lib/server/supabase/types";

/*
  Данные страниц бота — только DTO. Токен Telegram, хеш секрета вебхука, id чата владельца
  и IP-хеши сюда не попадают никогда. Каждая функция для кабинета получает уже проверенного
  пользователя (requireUser / requireStaff) и сама проверяет, что бот его.
*/

export type ChatMessageView = { id: string; role: "user" | "assistant"; text: string };

export type MyBotView = {
  id: string;
  slug: string;
  name: string;
  soul: string;
  knowledge: string;
  tools: BotTools;
  avatarJobId: string | null;
  avatarUrl: string | null;
  active: boolean;
  /** пауза владельца */
  paused: boolean;
  publicPath: string;
  lifetime: BotLifetime;
  /** «Контакт» в заявке и Telegram: владелец 18+ или ведущий */
  adult: boolean;
  /** открытки гостям на странице бота (у младших — только в проверке) */
  guestCards: boolean;
  prices: { reply: number; card: number | null };
  telegram: { connected: boolean; username: string | null; connectedAt: string | null; ownerLinked: boolean; ownerLink: string | null };
  leadsCount: number;
};

async function priceOf(bot: BotRecord) {
  const subject = priceSubject(bot.owner);
  const [reply, card] = await Promise.all([
    canUse(subject, "bot_reply"),
    canUse(subject, bot.avatarJobId ? "image_edit" : "image"),
  ]);
  return { reply: reply.ok ? reply.stars : 0, card: card.ok ? card.stars : null };
}

function ownerLink(bot: BotRecord): string | null {
  const { username, botId, connectedAt } = bot.telegram;
  if (!username || !botId || !connectedAt || !bot.telegram.token) return null;
  return `https://t.me/${username}?start=owner_${ownerLinkCode(bot.id, botId, connectedAt)}`;
}

/** Бот текущего пользователя или null, если ещё не создан. */
export async function getMyBot(user: SessionUser): Promise<MyBotView | null> {
  const bot = await loadBotByOwner(user.id);
  if (!bot) return null;
  const [path, prices, leads] = await Promise.all([
    avatarPath(bot),
    priceOf(bot),
    createAdminClient().from("bot_leads").select("id", { count: "exact", head: true }).eq("bot_id", bot.id),
  ]);
  return {
    id: bot.id,
    slug: bot.slug,
    name: bot.name,
    soul: bot.soul,
    knowledge: bot.knowledge,
    tools: bot.tools,
    avatarJobId: path ? bot.avatarJobId : null,
    avatarUrl: path ? await signedMediaUrl(path) : null,
    active: bot.active,
    paused: bot.paused,
    publicPath: `/b/${bot.slug}`,
    lifetime: lifetimeOf(bot),
    adult: isAdultOwner(bot.owner),
    guestCards: cardsAvailable(bot, "web", false),
    prices,
    telegram: {
      connected: Boolean(bot.telegram.token),
      username: bot.telegram.username,
      connectedAt: bot.telegram.connectedAt,
      ownerLinked: bot.telegram.ownerChatId !== null,
      ownerLink: ownerLink(bot),
    },
    leadsCount: leads.count ?? 0,
  };
}

export type MyBotSummary = { id: string; slug: string; name: string; publicPath: string; lifetime: BotLifetime; leadsCount: number };

/** Коротко о боте — для вкладок «Заявки» и «Забери с собой». */
export async function getMyBotSummary(user: SessionUser): Promise<MyBotSummary | null> {
  const bot = await loadBotByOwner(user.id);
  if (!bot) return null;
  const { count } = await createAdminClient()
    .from("bot_leads")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", bot.id);
  return {
    id: bot.id,
    slug: bot.slug,
    name: bot.name,
    publicPath: `/b/${bot.slug}`,
    lifetime: lifetimeOf(bot),
    leadsCount: count ?? 0,
  };
}

export type GalleryImage = { jobId: string; url: string; label: string };

/** Готовые картинки владельца для аватара (из его галереи), новые сверху. */
export async function listMyImages(user: SessionUser): Promise<GalleryImage[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .select("id, prompt, storage_path, created_at")
    .eq("user_id", user.id)
    .eq("status", "done")
    .eq("hidden", false)
    .is("deleted_at", null)
    .in("action", ["image", "image_edit"])
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) throw new Error(`bot.dal.listMyImages failed (${error.code})`);
  const rows = (data ?? []).filter((row) => row.storage_path);
  if (!rows.length) return [];
  // свои готовые картинки (проверено запросом выше) — подпись через общий кеш, как в галерее
  const urls = await signMediaPaths(rows.map((row) => row.storage_path!));
  return rows
    .map((row) => ({ jobId: row.id, url: urls.get(row.storage_path!) ?? "", label: (row.prompt ?? "").slice(0, 80) }))
    .filter((image) => image.url);
}

function toChat(messages: { id: number; role: "user" | "assistant"; content: string }[]): ChatMessageView[] {
  return messages
    .filter((m) => m.content !== HIDDEN_MESSAGE)
    .map((m) => ({ id: String(m.id), role: m.role, text: m.content }));
}

/** Последние сообщения проверки владельцем. */
export async function getPreviewHistory(user: SessionUser, botId: string): Promise<ChatMessageView[]> {
  return toChat(await loadHistory(botId, previewConversationId(user.id), { limit: 20 }));
}

export type LeadView = { id: string; channel: "web" | "telegram"; createdAt: string; data: Record<string, string> };

/**
 * Сколько заявок показывает страница «Заявки» (новые сверху). Меньше Max Rows PostgREST (1000):
 * иначе сервер молча обрезал бы список. Все заявки — в CSV (аудит № 40).
 */
export const LEADS_PAGE = 500;

type LeadRow = { id: string; channel: "web" | "telegram"; created_at: string; data: unknown };

function toLeadView(row: LeadRow): LeadView {
  return {
    id: row.id,
    channel: row.channel,
    createdAt: row.created_at,
    data: Object.fromEntries(
      Object.entries((row.data ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]),
    ),
  };
}

/**
 * Заявки бота владельца, новые сверху. По умолчанию — последние LEADS_PAGE и общее число (total);
 * all — все заявки страницами (для CSV).
 */
export async function listMyLeads(
  user: SessionUser,
  options: { all?: boolean } = {},
): Promise<{ form: LeadForm | null; leads: LeadView[]; total: number } | null> {
  const bot = await loadBotByOwner(user.id);
  if (!bot) return null;
  const db = createAdminClient();
  const columns = "id, channel, created_at, data";

  if (options.all) {
    // Старые сверху: новая заявка во время выгрузки встаёт в конец и не сдвигает страницы
    const rows = await fetchAll<LeadRow>(
      (from, to) =>
        db
          .from("bot_leads")
          .select(columns)
          .eq("bot_id", bot.id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "bot.dal.listMyLeads",
    );
    const leads = rows.reverse().map(toLeadView);
    return { form: bot.tools.leadForm, leads, total: leads.length };
  }

  const { data, error, count } = await db
    .from("bot_leads")
    .select(columns, { count: "exact" })
    .eq("bot_id", bot.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, LEADS_PAGE - 1);
  if (error) throw new Error(`bot.dal.listMyLeads failed (${error.code})`);
  const leads = (data ?? []).map(toLeadView);
  return { form: bot.tools.leadForm, leads, total: Math.max(count ?? 0, leads.length) };
}

// ---------- публичная страница /b/[slug] ----------

export type PublicBotView =
  | {
      state: "active";
      slug: string;
      name: string;
      avatarUrl: string | null;
      greeting: string;
      buttons: string[];
      history: ChatMessageView[];
      leads: boolean;
      contactInLeads: boolean;
      cards: boolean;
      /** пауза владельца: страница открывается, бот отвечает «на паузе» */
      paused: boolean;
    }
  | { state: "retired"; slug: string; name: string; avatarUrl: string | null };

export async function getPublicBot(slug: string, sessionId: string | null): Promise<PublicBotView | null> {
  const bot = await loadBotBySlug(slug);
  if (!bot) return null;
  const path = await avatarPath(bot);
  const avatarUrl = path ? await signedMediaUrl(path) : null;
  if (!bot.active || lifetimeOf(bot).retired) return { state: "retired", slug: bot.slug, name: bot.name, avatarUrl };

  const extras = parseSoulExtras(bot.soul);
  const history = sessionId ? toChat(await loadHistory(bot.id, webConversationId(sessionId))) : [];
  const leads = bot.tools.leads && Boolean(bot.tools.leadForm);
  return {
    state: "active",
    slug: bot.slug,
    name: bot.name,
    avatarUrl,
    greeting: extras.greeting ?? defaultGreeting(bot.name),
    buttons: extras.buttons,
    history,
    leads,
    contactInLeads:
      leads && isAdultOwner(bot.owner) && Boolean(bot.tools.leadForm?.fields.some((f) => f.type === "contact")),
    cards: cardsAvailable(bot, "web", false),
    paused: bot.paused,
  };
}

// ---------- учитель: боты группы ----------

export type GroupBotRow = {
  botId: string;
  slug: string;
  name: string;
  ownerNickname: string;
  ownerLogin: string | null;
  ownerAgeBand: AgeBand;
  tools: { leads: boolean; image: boolean; knowledge: boolean };
  telegramUsername: string | null;
  leadsCount: number;
  guestMessagesWeek: number;
  updatedAt: string;
};

/** Боты учеников группы с числом заявок. Только для ведущего этой группы и админа. */
export async function listGroupBots(
  user: SessionUser,
  groupId: string,
): Promise<{ group: { id: string; code: string; title: string; endsOn: string | null }; bots: GroupBotRow[] } | null> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const group = await getGroup(user, groupId);
  if (!group) return null;

  const db = createAdminClient();
  const { data: students, error } = await db
    .from("profiles")
    .select("id, login, nickname, age_band")
    .eq("group_id", group.id)
    .eq("role", "student");
  if (error) throw new Error(`bot.dal.listGroupBots students failed (${error.code})`);
  const owners = new Map((students ?? []).map((s) => [s.id, s]));
  if (!owners.size) return { group: { id: group.id, code: group.code, title: group.title, endsOn: group.endsOn }, bots: [] };

  const { data: bots, error: botsError } = await db
    .from("bots")
    .select("id, owner_id, slug, name, tools, telegram_bot_username, telegram_token_ciphertext, updated_at")
    .in("owner_id", [...owners.keys()])
    .order("name", { ascending: true });
  if (botsError) throw new Error(`bot.dal.listGroupBots bots failed (${botsError.code})`);

  // Счётчики всех ботов — одним запросом (аудит № 39: было 2 запроса на каждого бота)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const botIds = (bots ?? []).map((bot) => bot.id);
  const counters = new Map<string, { leads: number; messages: number }>();
  if (botIds.length) {
    const { data, error: countersError } = await db.rpc("group_bot_counters", { p_bot_ids: botIds, p_since: weekAgo });
    if (countersError) throw new Error(`bot.dal.listGroupBots counters failed (${countersError.code})`);
    for (const row of data ?? []) {
      counters.set(row.bot_id, { leads: Number(row.leads_count), messages: Number(row.guest_messages) });
    }
  }

  const rows = (bots ?? []).map((bot): GroupBotRow => {
    const owner = owners.get(bot.owner_id)!;
    const tools = (bot.tools ?? {}) as Record<string, unknown>;
    return {
      botId: bot.id,
      slug: bot.slug,
      name: bot.name,
      ownerNickname: owner.nickname,
      ownerLogin: owner.login,
      ownerAgeBand: owner.age_band,
      tools: { leads: tools.leads === true, image: tools.image === true, knowledge: tools.knowledge === true },
      telegramUsername: bot.telegram_token_ciphertext ? bot.telegram_bot_username : null,
      leadsCount: counters.get(bot.id)?.leads ?? 0,
      guestMessagesWeek: counters.get(bot.id)?.messages ?? 0,
      updatedAt: bot.updated_at,
    };
  });
  return { group: { id: group.id, code: group.code, title: group.title, endsOn: group.endsOn }, bots: rows };
}
