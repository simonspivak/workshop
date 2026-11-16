"use server";

import { setTimeout as sleep } from "node:timers/promises";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginToEmail } from "@/lib/server/accounts";
import { audit } from "@/lib/server/audit";
import { clientIp, ipRateLimitKey } from "@/lib/server/bot/ratelimit";
import { homePath, isStaff } from "@/lib/server/dal/auth";
import { isSupabaseConfigured, studentEmailDomain } from "@/lib/server/env";
import { LOGIN_LIMITS, keyFor, refundAttempt, reserveAttempt, resetAttempts, takeAttempt } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import { safeNext } from "./next-path";

export type LoginState = { error: string } | null;

const schema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

const WRONG = "Логин или пароль неверны.";
// Окно наших счётчиков — 15 минут (LOGIN_LIMITS); ведущий может снять блокировку или выдать новый пароль
const TOO_MANY = "Слишком много попыток входа. Подождите до 15 минут и попробуйте снова или попросите ведущего помочь.";
// 429 от самого Supabase Auth (его общий лимит на IP сервера) — после двух повторов; отпускает за секунды
const AUTH_BUSY = "Сервер входа перегружен. Подождите 10 секунд и нажмите «Войти» ещё раз.";

/** Повторы входа при 429 Supabase: бакет пополняется ~0,5 запроса/с, поэтому пауза 1,5–3 с с разбросом. */
const AUTH_BUSY_RETRIES = 2;
const retryDelayMs = () => 1_500 + Math.floor(Math.random() * 1_500);

type SignInResult = Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["signInWithPassword"]>>;

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

  // Защита от перебора (Supabase видит только IP сервера):
  //  • по IP считаются только неудачи — попытка занимается до проверки и возвращается при успехе;
  //  • по логину — каждая попытка, после успеха счётчик сбрасывается.
  const ip = ipRateLimitKey(clientIp(await headers()) ?? "unknown");
  const ipSlot = await reserveAttempt(LOGIN_LIMITS.ip, ip);
  if (!ipSlot) {
    // Без логина и IP: только какой счётчик сработал
    console.warn("login: rate limit exhausted", { purpose: LOGIN_LIMITS.ip.purpose });
    return { error: TOO_MANY };
  }
  if (!(await takeAttempt(LOGIN_LIMITS.account, email))) {
    // Попытка с IP остаётся засчитанной: перебор по заблокированным логинам не бесплатен
    console.warn("login: rate limit exhausted", { purpose: LOGIN_LIMITS.account.purpose });
    await auditStaffFailure(email, ip, "locked");
    return { error: TOO_MANY };
  }

  // Server Action: сессию пишем и при необходимости удаляем (signOut ниже)
  const supabase = await createClient({ allowSignOut: true });
  let result: SignInResult = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  for (let retry = 1; retry <= AUTH_BUSY_RETRIES && result.error?.status === 429; retry++) {
    // Повтор — та же попытка: счётчики не трогаем
    await sleep(retryDelayMs());
    result = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  }
  const { data, error } = result;
  if (error || !data.user) {
    if (error?.status === 429) {
      // Пароль не проверен — попытку с IP возвращаем
      console.warn("login: supabase auth 429", { code: error.code, retries: AUTH_BUSY_RETRIES });
      await refundAttempt(ipSlot);
      return { error: AUTH_BUSY };
    }
    // Общий текст: по ответу нельзя узнать, существует ли логин
    await auditStaffFailure(email, ip, "wrong");
    return { error: WRONG };
  }
  await Promise.all([refundAttempt(ipSlot), resetAttempts(LOGIN_LIMITS.account, email)]);

  const { data: profile } = await supabase.from("profiles").select("role, disabled").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.disabled) {
    // Отключённый аккаунт — выход со всех устройств (намеренно global)
    await supabase.auth.signOut({ scope: "global" });
    if (profile && isStaff(profile)) await auditLogin("login.failed", data.user.id, ip, "disabled");
    return { error: "Аккаунт отключён. Обратитесь к ведущему." };
  }
  if (isStaff(profile)) await auditLogin("login.success", data.user.id, ip);

  redirect(safeNext(parsed.data.next) ?? homePath(profile));
}

/*
  Журнал входов ведущих и админа (аудит № 59): успех и неудача — в audit_log.
  Ученики сюда не пишутся (их входы есть в логах Supabase Auth). Без пароля, логина и IP:
  только id аккаунта и HMAC сети (тот же вывод ключа, что у счётчиков). Объём ограничен
  счётчиками: не больше 20 неудач на аккаунт и 300 с одного IP за 15 минут.
*/

async function auditLogin(action: "login.success" | "login.failed", userId: string, ip: string, reason?: string) {
  await audit({
    actorId: action === "login.success" ? userId : null,
    action,
    targetUser: userId,
    meta: { ip: keyFor("audit-ip", ip), reason },
  });
}

/** Неудача по адресу ведущего: ищем аккаунт по адресу (технические адреса учеников не ищем). */
async function auditStaffFailure(email: string, ip: string, reason: "wrong" | "locked") {
  try {
    if (email.endsWith(`@${studentEmailDomain()}`)) return;
    const { data: staffId, error } = await createAdminClient().rpc("staff_id_by_email", { p_email: email });
    if (error) {
      console.error("login: staff lookup failed", { code: error.code });
      return;
    }
    if (staffId) await auditLogin("login.failed", staffId, ip, reason);
  } catch {
    // журнал не должен мешать входу
  }
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient({ allowSignOut: true });
    // «Выйти» — только на этом устройстве; по умолчанию auth-js выходит со всех (scope: "global")
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/login");
}
