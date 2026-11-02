"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loginToEmail } from "@/lib/server/accounts";
import { homePath } from "@/lib/server/dal/auth";
import { isSupabaseConfigured } from "@/lib/server/env";
import { createClient } from "@/lib/server/supabase/server";

export type LoginState = { error: string } | null;

const schema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

const WRONG = "Логин или пароль неверны.";

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    // Общий текст: по ответу нельзя узнать, существует ли логин
    if (error?.status === 429) return { error: "Слишком много попыток. Подождите пару минут и попробуйте снова." };
    return { error: WRONG };
  }

  const { data: profile } = await supabase.from("profiles").select("role, disabled").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.disabled) {
    await supabase.auth.signOut();
    return { error: "Аккаунт отключён. Обратитесь к ведущему." };
  }

  redirect(safeNext(parsed.data.next) ?? homePath(profile));
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
