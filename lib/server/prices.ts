import "server-only";
import type { SessionUser } from "@/lib/server/dal/auth";
import { createAdminClient } from "@/lib/server/supabase/admin";
import type { PriceAccess, PriceAction, PriceTier } from "@/lib/server/supabase/types";

/*
  Прайс и правила доступа к моделям (docs/platform/spec.md §2).
  Источник цен — таблица price_list (админ меняет без деплоя). Правила по возрасту и роли —
  колонка access:
    all                  — всем;
    adult                — только 18+;
    google               — 18+; младшим только если в группе включено allow_google_minors;
    adult_or_16_consent  — 18+ или 16–17 с отметкой согласия родителей;
    staff                — только учитель и админ.
  Учитель и админ генерируют бесплатно любой моделью из прайса (демо-режим), задача всё равно
  пишется в журнал. Пауза группы, дневной лимит и баланс проверяет SQL (create_job) атомарно.
*/

export type PriceEntry = {
  action: PriceAction;
  model: string;
  tier: PriceTier;
  stars: number;
  access: PriceAccess;
  libraryOnly: boolean;
  position: number;
  label: string | null;
};

export type UseDenied = "unknown_model" | "staff_only" | "adult_only" | "google_minors" | "consent_required";

export type UseDecision =
  | {
      ok: true;
      action: PriceAction;
      model: string;
      tier: PriceTier;
      /** сколько списать; 0 для учителя и админа */
      stars: number;
      /** цена по прайсу (для подписи на кнопке у учителя) */
      listStars: number;
      free: boolean;
      /** входные файлы только из библиотеки курса (motion) */
      libraryOnly: boolean;
      label: string | null;
    }
  | { ok: false; reason: UseDenied; model: string | null };

/** Порог «длинного» ответа и видео: > 800 токенов текста, > 5 секунд видео. */
export const LONG_TEXT_TOKENS = 800;
export const LONG_VIDEO_SECONDS = 5;

export type PriceOptions = { maxTokens?: number; duration?: number };

export function priceTier(action: PriceAction, options: PriceOptions = {}): PriceTier {
  if (action === "text" && (options.maxTokens ?? 0) > LONG_TEXT_TOKENS) return "long";
  if (action === "video" && (options.duration ?? 0) > LONG_VIDEO_SECONDS) return "long";
  return "base";
}

const TTL_MS = 60_000;
let cache: { at: number; rows: PriceEntry[] } | null = null;

/** Включённые строки прайса. Кешируется в памяти на минуту. */
export async function getPriceList(): Promise<PriceEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data, error } = await createAdminClient()
    .from("price_list")
    .select("action, model, tier, stars, access, library_only, position, label")
    .eq("enabled", true)
    .order("position", { ascending: true });
  if (error) throw new Error(`prices: query failed (${error.code})`);
  const rows: PriceEntry[] = (data ?? []).map((row) => ({
    action: row.action,
    model: row.model,
    tier: row.tier,
    stars: row.stars,
    access: row.access,
    libraryOnly: row.library_only,
    position: row.position,
    label: row.label,
  }));
  cache = { at: Date.now(), rows };
  return rows;
}

/** Сбросить кеш прайса (после правки цен админом). */
export function invalidatePriceCache(): void {
  cache = null;
}

type AccessSubject = Pick<SessionUser, "role" | "ageBand" | "parentalConsent" | "group">;

const isStaff = (user: Pick<SessionUser, "role">) => user.role === "teacher" || user.role === "admin";

/** Проверка одного правила доступа без учёта цены. */
export function checkAccess(user: AccessSubject, access: PriceAccess): UseDenied | null {
  if (isStaff(user)) return null;
  switch (access) {
    case "all":
      return null;
    case "adult":
      return user.ageBand === "adult" ? null : "adult_only";
    case "google":
      return user.ageBand === "adult" || user.group?.allowGoogleMinors ? null : "google_minors";
    case "adult_or_16_consent":
      if (user.ageBand === "adult") return null;
      if (user.ageBand === "16_17") return user.parentalConsent ? null : "consent_required";
      return "adult_only";
    case "staff":
      return "staff_only";
  }
}

/**
 * Можно ли пользователю это действие этой моделью и сколько оно стоит.
 * Без model — первая по порядку модель действия, доступная пользователю.
 * Возраст и роль — здесь; пауза, лимит и баланс — в SQL при списании.
 */
export async function canUse(
  user: AccessSubject,
  action: PriceAction,
  model?: string | null,
  options: PriceOptions = {},
): Promise<UseDecision> {
  const rows = (await getPriceList()).filter((row) => row.action === action);
  const tier = priceTier(action, options);

  const models = [...new Set(rows.map((row) => row.model))];
  let chosen: string | undefined;
  if (model) {
    chosen = models.find((m) => m === model);
    if (!chosen) return { ok: false, reason: "unknown_model", model };
  } else {
    chosen = models.find((m) => !checkAccess(user, rowFor(rows, m, tier)!.access)) ?? models[0];
    if (!chosen) return { ok: false, reason: "unknown_model", model: null };
  }

  const row = rowFor(rows, chosen, tier)!;
  const denied = checkAccess(user, row.access);
  if (denied) return { ok: false, reason: denied, model: chosen };

  const free = isStaff(user);
  return {
    ok: true,
    action,
    model: chosen,
    tier: row.tier,
    stars: free ? 0 : row.stars,
    listStars: row.stars,
    free,
    libraryOnly: row.libraryOnly,
    label: row.label,
  };
}

/** Модели действия с ценой и доступностью — для подписей на кнопках и выбора модели. */
export async function listModels(
  user: AccessSubject,
  action: PriceAction,
  options: PriceOptions = {},
): Promise<{ model: string; label: string | null; stars: number; available: boolean; reason: UseDenied | null }[]> {
  const rows = (await getPriceList()).filter((row) => row.action === action);
  const tier = priceTier(action, options);
  const models = [...new Set(rows.map((row) => row.model))];
  return models
    .map((model) => {
      const row = rowFor(rows, model, tier)!;
      const reason = checkAccess(user, row.access);
      return { model, label: row.label, stars: isStaff(user) ? 0 : row.stars, available: !reason, reason };
    })
    .filter((entry) => entry.reason !== "staff_only");
}

function rowFor(rows: PriceEntry[], model: string, tier: PriceTier): PriceEntry | undefined {
  return (
    rows.find((row) => row.model === model && row.tier === tier) ?? rows.find((row) => row.model === model && row.tier === "base")
  );
}
