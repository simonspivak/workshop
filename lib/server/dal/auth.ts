import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/server/env";
import { createClient } from "@/lib/server/supabase/server";
import type { AgeBand, AppRole } from "@/lib/server/supabase/types";

export type Role = AppRole;

/** Минимум о вошедшем пользователе. Можно передавать в клиентские компоненты. */
export type SessionUser = {
  id: string;
  role: Role;
  login: string | null;
  nickname: string;
  ageBand: AgeBand;
  parentalConsent: boolean;
  group: {
    id: string;
    code: string;
    title: string;
    paused: boolean;
    allowGoogleMinors: boolean;
    shareGallery: boolean;
    endsOn: string | null;
  } | null;
};

export const STAFF_ROLES = ["teacher", "admin"] as const satisfies readonly Role[];

export function isStaff(user: Pick<SessionUser, "role">): boolean {
  return user.role === "teacher" || user.role === "admin";
}

/** Куда вести пользователя после входа или при чужой роли. */
export function homePath(user: Pick<SessionUser, "role">): "/app" | "/teach" {
  return isStaff(user) ? "/teach" : "/app";
}

/**
 * Текущий пользователь или null. Проверяет подпись JWT (getClaims, не getSession),
 * затем читает профиль из базы (через RLS): роль берётся только из profiles.role.
 * Отключённый пользователь считается невошедшим. Кешируется на один рендер.
 *
 * Читает cookie, поэтому компонент, который это вызывает, должен быть внутри <Suspense>.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Сначала — данные запроса: так ответ всегда считается при запросе и не «запекается»
  // при сборке (даже если переменных Supabase на сборке нет).
  await cookies();
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;

  const { data: row, error } = await supabase
    .from("profiles")
    .select(
      "id, role, login, nickname, age_band, parental_consent_at, disabled, " +
        "group:groups!profiles_group_fk(id, code, title, paused, allow_google_minors, share_gallery, ends_on)",
    )
    .eq("id", userId)
    .maybeSingle<ProfileWithGroup>();

  if (error) {
    console.error("dal.getUser: profile query failed", { code: error.code });
    return null;
  }
  if (!row || row.disabled) return null;

  return {
    id: row.id,
    role: row.role,
    login: row.login,
    nickname: row.nickname,
    ageBand: row.age_band,
    parentalConsent: row.parental_consent_at !== null,
    group: row.group
      ? {
          id: row.group.id,
          code: row.group.code,
          title: row.group.title,
          paused: row.group.paused,
          allowGoogleMinors: row.group.allow_google_minors,
          shareGallery: row.group.share_gallery,
          endsOn: row.group.ends_on,
        }
      : null,
  };
});

type ProfileWithGroup = {
  id: string;
  role: Role;
  login: string | null;
  nickname: string;
  age_band: AgeBand;
  parental_consent_at: string | null;
  disabled: boolean;
  group: {
    id: string;
    code: string;
    title: string;
    paused: boolean;
    allow_google_minors: boolean;
    share_gallery: boolean;
    ends_on: string | null;
  } | null;
};

/** Для страниц: без входа — на /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Для страниц: без входа — на /login, с другой ролью — в свой кабинет. */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homePath(user));
  return user;
}

export function requireStaff(): Promise<SessionUser> {
  return requireRole(STAFF_ROLES);
}

/** Ошибка авторизации для Server Actions и Route Handlers (без редиректов). */
export class AuthError extends Error {
  constructor(readonly code: "unauthorized" | "forbidden") {
    super(code);
    this.name = "AuthError";
  }
}

/**
 * Для Server Actions и Route Handlers: каждый вызывает это сам, на proxy.ts не полагаемся.
 * Без входа — AuthError('unauthorized'), с другой ролью — AuthError('forbidden').
 */
export async function authorize(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AuthError("unauthorized");
  if (roles && !roles.includes(user.role)) throw new AuthError("forbidden");
  return user;
}
