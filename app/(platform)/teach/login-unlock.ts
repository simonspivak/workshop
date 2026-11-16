"use server";

import { z } from "zod";
import { loginToEmail } from "@/lib/server/accounts";
import { audit } from "@/lib/server/audit";
import { AuthError, authorize, STAFF_ROLES } from "@/lib/server/dal/auth";
import { assertTeachesStudent } from "@/lib/server/dal/teacher";
import { ConfigError } from "@/lib/server/env";
import { LOGIN_LIMITS, resetAttempts } from "@/lib/server/rate-limit";
import type { ActionResult } from "@/lib/platform/messages";

/*
  «Снять блокировку входа» (аудит № 5, AUTH-3/SEC-07): обнуляет счётчик попыток по логину
  ученика, не меняя пароль на карточке. Лимит по IP не трогаем: он общий для всей сети и считает
  только неудачи (300 за 15 минут). Пишется в audit_log.
*/

const schema = z.object({ studentId: z.uuid() });

export async function unlockStudentLogin(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    const { student, group } = await assertTeachesStudent(user, parsed.data.studentId);

    // тот же ключ, что у входа (loginToEmail): иначе счётчик не совпадёт
    const accountKey = student.login ? loginToEmail(student.login) : null;
    if (!accountKey) return { ok: false, error: "invalid_input" };
    if (!(await resetAttempts(LOGIN_LIMITS.account, accountKey))) return { ok: false, error: "server_error" };

    await audit({ actorId: user.id, action: "student.login_unlock", targetUser: student.id, targetGroup: group.id });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.code };
    if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
    console.error("teach.unlockStudentLogin: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "server_error" };
  }
}
