"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginToEmail } from "@/lib/server/accounts";
import { clientIp, ipRateLimitKey } from "@/lib/server/bot/ratelimit";
import { homePath } from "@/lib/server/dal/auth";
import { isSupabaseConfigured } from "@/lib/server/env";
import { LOGIN_LIMITS, resetAttempts, takeAttempt } from "@/lib/server/rate-limit";
import { createClient } from "@/lib/server/supabase/server";

export type LoginState = { error: string } | null;

const schema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

const WRONG = "Логин или пароль неверны.";
// Окно наших счётчиков — 15 минут (LOGIN_LIMITS); ведущий может выдать новый пароль — это снимает счётчик логина
const TOO_MANY = "Слишком много попыток входа. Подождите до 15 минут и попробуйте снова или попросите ведущего помочь.";
// 429 от самого Supabase Auth: его общий лимит на IP сервера, обычно отпускает быстро
const AUTH_BUSY = "Сервер входа перегружен. Подождите минуту и попробуйте снова.";

/** Только свои пути кабинета: защита от open redirect через ?next=. */
function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return /^\/(app|teach)(\/|\?|$)/.test(next) ? next : null;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: "Введите логин и пароль." };
  if (!isSupabaseConfigured()) return { error: "Платформа ещё не подключена к базе. Сообщите ведущему." };

  const email = loginToEmail(parsed.data.login);
  if (!email) return { error: WRONG };

  // Защита от перебора паролей: лимит попыток с IP и на логин (Supabase видит только IP сервера)
  const ip = ipRateLimitKey(clientIp(await headers()) ?? "unknown");
  const ipAllowed = await takeAttempt(LOGIN_LIMITS.ip, ip);
  if (!ipAllowed || !(await takeAttempt(LOGIN_LIMITS.account, email))) {
    // Без логина и IP: только какой счётчик сработал
    console.warn("login: rate limit exhausted", { purpose: (ipAllowed ? LOGIN_LIMITS.account : LOGIN_LIMITS.ip).purpose });
    return { error: TOO_MANY };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    // Общий текст: по ответу нельзя узнать, существует ли логин
    if (error?.status === 429) {
      console.warn("login: supabase auth 429", { code: error.code });
      return { error: AUTH_BUSY };
    }
    return { error: WRONG };
  }
  await resetAttempts(LOGIN_LIMITS.account, email);

  const { data: profile } = await supabase.from("profiles").select("role, disabled").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.disabled) {
    // Отключённый аккаунт — выход со всех устройств (намеренно global)
    await supabase.auth.signOut({ scope: "global" });
    return { error: "Аккаунт отключён. Обратитесь к ведущему." };
  }

  redirect(safeNext(parsed.data.next) ?? homePath(profile));
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    // «Выйти» — только на этом устройстве; по умолчанию auth-js выходит со всех (scope: "global")
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/login");
}
