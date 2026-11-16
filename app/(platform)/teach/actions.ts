"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assignLogins, generatePassword, loginToEmail, studentEmail, GROUP_CODE_RE } from "@/lib/server/accounts";
import { audit } from "@/lib/server/audit";
import { AuthError, authorize, STAFF_ROLES } from "@/lib/server/dal/auth";
import { STAFF_LIMIT_KEYS } from "@/lib/server/dal/admin";
import { assertTeachesGroup, assertTeachesStudent } from "@/lib/server/dal/teacher";
import { ConfigError } from "@/lib/server/env";
import { LOGIN_LIMITS, resetAttempts } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { grantStars, grantStarsToGroup } from "@/lib/server/wallet";
import type { ActionResult, ErrorCode } from "@/lib/platform/messages";

/*
  Мутации кабинета учителя. Каждая Action сама проверяет вход и роль (authorize) и то,
  что группа или ученик принадлежат этому учителю (assertTeaches…), валидирует вход zod,
  пишет audit_log и возвращает только то, что нужно интерфейсу.
  Пишем admin-клиентом: у клиентских ролей прав на запись нет.
*/

// 12 кругов по 5 вызовов Auth — несколько секунд, в maxDuration страницы (60 с) укладывается
const MAX_BATCH = 60;

/**
 * Звёзды «каждому ученику» в группе ведущего (не админа): стартовые звёзды идут триггером,
 * мимо лимитов grant_stars, поэтому без этой границы лимит начислений обходится созданием группы.
 */
const TEACHER_MAX_STARS_PER_STUDENT = 5000;

/** Ведущему — не больше TEACHER_MAX_STARS_PER_STUDENT на ученика; админу — как в схеме. */
function overTeacherStarsLimit(role: string, starsPerStudent: number) {
  if (role === "admin" || starsPerStudent <= TEACHER_MAX_STARS_PER_STUDENT) return null;
  return {
    ok: false as const,
    error: "invalid_input" as const,
    fields: { starsPerStudent: `Ведущему — не больше ${TEACHER_MAX_STARS_PER_STUDENT}★ на ученика. Больше — через администратора.` },
  };
}

const groupKinds = ["teens", "adults", "corporate", "individual", "demo"] as const;
const ageBands = ["u16", "16_17", "adult"] as const;

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
const optionalDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.iso.date().nullable(),
);
const uuid = z.uuid();

function fail(error: unknown, op: string): { ok: false; error: ErrorCode } {
  if (error instanceof AuthError) return { ok: false, error: error.code };
  if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
  console.error(`teach.${op}: unexpected error`, { error: error instanceof Error ? error.message : String(error) });
  return { ok: false, error: "server_error" };
}

function invalid(error: z.ZodError): { ok: false; error: "invalid_input"; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= "Проверьте это поле.";
  }
  return { ok: false, error: "invalid_input", fields };
}

// ---------- группы ----------

const groupFields = {
  title: z.string().trim().min(1).max(80),
  kind: z.enum(groupKinds),
  endsOn: optionalDate,
  budgetStars: z.coerce.number().int().min(0).max(100_000_000),
  plannedStudents: z.coerce.number().int().min(1).max(1000),
  starsPerStudent: z.coerce.number().int().min(0).max(1_000_000),
  allowGoogleMinors: checkbox,
  shareGallery: checkbox,
};

const createGroupSchema = z.object({
  code: z.string().trim().toLowerCase().regex(GROUP_CODE_RE),
  ...groupFields,
});

export async function createGroup(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let groupId: string;
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = createGroupSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    const overLimit = overTeacherStarsLimit(user.role, input.starsPerStudent);
    if (overLimit) return overLimit;

    const { data, error } = await createAdminClient()
      .from("groups")
      .insert({
        code: input.code,
        title: input.title,
        kind: input.kind,
        ends_on: input.endsOn,
        budget_stars: input.budgetStars,
        planned_students: input.plannedStudents,
        stars_per_student: input.starsPerStudent,
        allow_google_minors: input.allowGoogleMinors,
        share_gallery: input.shareGallery,
        teacher_id: user.id,
      })
      .select("id")
      .single();
    if (error?.code === "23505") return { ok: false, error: "group_code_taken", fields: { code: "Код занят." } };
    if (error || !data) throw new Error(`insert group failed (${error?.code})`);

    groupId = data.id;
    await audit({ actorId: user.id, action: "group.create", targetGroup: groupId, meta: { code: input.code } });
  } catch (error) {
    return fail(error, "createGroup");
  }
  redirect(`/teach/groups/${groupId}`);
}

const updateGroupSchema = z.object({ groupId: uuid, ...groupFields });

export async function updateGroup(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = updateGroupSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    const overLimit = overTeacherStarsLimit(user.role, input.starsPerStudent);
    if (overLimit) return overLimit;
    const group = await assertTeachesGroup(user, input.groupId);

    const { error } = await createAdminClient()
      .from("groups")
      .update({
        title: input.title,
        kind: input.kind,
        ends_on: input.endsOn,
        budget_stars: input.budgetStars,
        planned_students: input.plannedStudents,
        stars_per_student: input.starsPerStudent,
        allow_google_minors: input.allowGoogleMinors,
        share_gallery: input.shareGallery,
      })
      .eq("id", group.id);
    if (error) throw new Error(`update group failed (${error.code})`);

    await audit({
      actorId: user.id,
      action: "group.update",
      targetGroup: group.id,
      meta: {
        endsOn: input.endsOn,
        budgetStars: input.budgetStars,
        plannedStudents: input.plannedStudents,
        starsPerStudent: input.starsPerStudent,
        allowGoogleMinors: input.allowGoogleMinors,
        shareGallery: input.shareGallery,
      },
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "updateGroup");
  }
}

const pauseSchema = z.object({ groupId: uuid, paused: z.enum(["1", "0"]) });

export async function setGroupPaused(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = pauseSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const group = await assertTeachesGroup(user, parsed.data.groupId);
    const paused = parsed.data.paused === "1";

    const { error } = await createAdminClient().from("groups").update({ paused }).eq("id", group.id);
    if (error) throw new Error(`pause group failed (${error.code})`);

    await audit({ actorId: user.id, action: paused ? "group.pause" : "group.resume", targetGroup: group.id });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "setGroupPaused");
  }
}

// ---------- ученики ----------

export type CreatedStudent = { nickname: string; login: string; password: string };
export type CreateStudentsResult = ActionResult<{ created: CreatedStudent[]; failed: string[] }>;

const createStudentsSchema = z.object({
  groupId: uuid,
  nicknames: z.string().max(4000),
  ageBand: z.enum(ageBands),
  consent: checkbox,
});

function parseNicknames(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of raw.split(/[\n,;]+/)) {
    const nickname = line.replace(/\s+/g, " ").trim().slice(0, 40);
    const key = nickname.toLowerCase();
    if (nickname && !seen.has(key)) {
      seen.add(key);
      result.push(nickname);
    }
  }
  return result;
}

/**
 * Создать пачку учеников: ник → логин <код>-<ник> + пароль из трёх слов и двух цифр.
 * Пароли возвращаются один раз (для печати карточек) и нигде не сохраняются.
 * Профиль, кошелёк и звёзды группы (stars_per_student) создаёт триггер в базе.
 */
export async function createStudents(_prev: CreateStudentsResult | null, formData: FormData): Promise<CreateStudentsResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = createStudentsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    const group = await assertTeachesGroup(user, input.groupId);

    const nicknames = parseNicknames(input.nicknames);
    if (nicknames.length === 0) return { ok: false, error: "invalid_input", fields: { nicknames: "Впишите хотя бы один ник." } };
    if (nicknames.length > MAX_BATCH) return { ok: false, error: "too_many_students" };

    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("profiles")
      .select("login")
      .like("login", `${group.code}-%`);
    if (existingError) throw new Error(`load logins failed (${existingError.code})`);
    const logins = assignLogins(
      group.code,
      nicknames,
      (existing ?? []).map((row) => row.login).filter((login): login is string => Boolean(login)),
    );

    const created: (CreatedStudent & { id: string })[] = [];
    const failed: string[] = [];
    const jobs = nicknames.map((nickname, i) => ({ nickname, login: logins[i], password: generatePassword() }));

    // по 5 параллельно: быстрее, но без всплеска запросов к Auth
    for (let i = 0; i < jobs.length; i += 5) {
      const batch = jobs.slice(i, i + 5);
      const results = await Promise.all(
        batch.map((job) =>
          admin.auth.admin.createUser({
            email: studentEmail(job.login),
            password: job.password,
            email_confirm: true,
            app_metadata: {
              login: job.login,
              nickname: job.nickname,
              group_id: group.id,
              age_band: input.ageBand,
              created_by: user.id,
            },
          }),
        ),
      );
      results.forEach((res, j) => {
        const job = batch[j];
        if (res.error || !res.data.user) {
          console.error("teach.createStudents: createUser failed", { status: res.error?.status, code: res.error?.code });
          failed.push(job.nickname);
        } else {
          created.push({ ...job, id: res.data.user.id });
        }
      });
    }

    if (input.consent && created.length) {
      const { error } = await admin
        .from("profiles")
        .update({ parental_consent_at: new Date().toISOString() })
        .in(
          "id",
          created.map((s) => s.id),
        );
      if (error) console.error("teach.createStudents: consent update failed", { code: error.code });
    }

    await audit({
      actorId: user.id,
      action: "students.create",
      targetGroup: group.id,
      meta: {
        count: created.length,
        failed: failed.length,
        ageBand: input.ageBand,
        consent: input.consent,
        logins: created.map((s) => s.login),
      },
    });
    refresh();
    return {
      ok: true,
      created: created.map(({ nickname, login, password }) => ({ nickname, login, password })),
      failed,
    };
  } catch (error) {
    return fail(error, "createStudents");
  }
}

const studentSchema = z.object({ studentId: uuid });

export type ResetPasswordResult = ActionResult<{ login: string; password: string }>;

/** Новый пароль ученику. Показывается один раз. */
export async function resetStudentPassword(
  _prev: ResetPasswordResult | null,
  formData: FormData,
): Promise<ResetPasswordResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = studentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const { student, group } = await assertTeachesStudent(user, parsed.data.studentId);

    const password = generatePassword();
    const { error } = await createAdminClient().auth.admin.updateUserById(student.id, { password });
    if (error) throw new Error(`reset password failed (${error.status})`);
    // Новый пароль снимает и блокировку входа по логину: ключ тот же, что в login (loginToEmail)
    const accountKey = student.login ? loginToEmail(student.login) : null;
    if (accountKey) await resetAttempts(LOGIN_LIMITS.account, accountKey);

    await audit({ actorId: user.id, action: "student.password_reset", targetUser: student.id, targetGroup: group.id });
    return { ok: true, login: student.login ?? "", password };
  } catch (error) {
    return fail(error, "resetStudentPassword");
  }
}

const ageSchema = z.object({ studentId: uuid, ageBand: z.enum(ageBands), consent: checkbox });

/** Возраст и отметка «согласие родителей получено». */
export async function updateStudentAge(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = ageSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const { student, group } = await assertTeachesStudent(user, parsed.data.studentId);

    const consentAt = parsed.data.consent ? (student.consentAt ?? new Date().toISOString()) : null;
    const { error } = await createAdminClient()
      .from("profiles")
      .update({ age_band: parsed.data.ageBand, parental_consent_at: consentAt })
      .eq("id", student.id);
    if (error) throw new Error(`update age failed (${error.code})`);

    await audit({
      actorId: user.id,
      action: "student.age_update",
      targetUser: student.id,
      targetGroup: group.id,
      meta: { ageBand: parsed.data.ageBand, consent: parsed.data.consent },
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "updateStudentAge");
  }
}

const grantSchema = z.object({
  studentId: uuid,
  amount: z.coerce
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((n) => n !== 0),
  note: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export type GrantResult = ActionResult<{ balance: number }>;

/** Начислить или снять звёзды. Повтор с тем же ключом формы не начисляет второй раз. */
export async function grantStudentStars(_prev: GrantResult | null, formData: FormData): Promise<GrantResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = grantSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const { student } = await assertTeachesStudent(user, parsed.data.studentId);

    const result = await grantStars({
      actorId: user.id,
      userId: student.id,
      amount: parsed.data.amount,
      note: parsed.data.note || null,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!result.ok) return { ok: false, error: result.error };
    refresh();
    return { ok: true, balance: result.balance };
  } catch (error) {
    return fail(error, "grantStudentStars");
  }
}

const groupGrantSchema = z
  .object({
    groupId: uuid,
    mode: z.enum(["add", "top_up_to"]),
    amount: z.coerce
      .number()
      .int()
      .min(-10_000)
      .max(10_000)
      .refine((n) => n !== 0),
    note: z.string().trim().max(200).optional(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .refine((v) => v.mode === "add" || v.amount > 0, { path: ["amount"] });

export type GroupGrantResult = ActionResult<{ affected: number; skipped: number; total: number; already: boolean }>;

/**
 * Начислить всем ученикам группы (аудит № 27): «+N каждому» или «довести каждого до N».
 * Лимиты ведущего проверяет SQL (grant_limit) на каждое начисление; при отказе — никому.
 * Повтор с тем же ключом формы ничего не меняет. Отключённые ученики пропускаются.
 */
export async function grantGroupStars(_prev: GroupGrantResult | null, formData: FormData): Promise<GroupGrantResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = groupGrantSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const group = await assertTeachesGroup(user, parsed.data.groupId);

    const result = await grantStarsToGroup({
      actorId: user.id,
      groupId: group.id,
      amount: parsed.data.amount,
      mode: parsed.data.mode,
      note: parsed.data.note || null,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!result.ok) return { ok: false, error: result.error };
    refresh();
    return { ok: true, affected: result.affected, skipped: result.skipped, total: result.total, already: result.already };
  } catch (error) {
    return fail(error, "grantGroupStars");
  }
}

const disableSchema = z.object({ studentId: uuid, disabled: z.enum(["1", "0"]) });

/**
 * Отключить или включить ученика (аудит № 26). Отключённый сразу считается невошедшим
 * (getUser), не входит и не тратит звёзды; SQL закрывает все его сессии и пишет audit_log.
 * Звёзды, работы и журнал остаются — аккаунт не удаляется.
 */
export async function setStudentDisabled(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = disableSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const { student } = await assertTeachesStudent(user, parsed.data.studentId);

    const { error } = await createAdminClient().rpc("set_student_disabled", {
      p_actor: user.id,
      p_user: student.id,
      p_disabled: parsed.data.disabled === "1",
    });
    if (error?.message === "forbidden") throw new AuthError("forbidden");
    if (error) throw new Error(`set_student_disabled failed (${error.code})`);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "setStudentDisabled");
  }
}

// ---------- пульт админа ----------

const generationSchema = z.object({ enabled: z.enum(["1", "0"]) });

/** «Стоп генераций»: settings.generation_enabled. SQL (create_job, spend_stars) читает его на каждой трате. */
export async function setGenerationEnabled(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(["admin"]);
    const parsed = generationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const enabled = parsed.data.enabled === "1";

    const { error } = await createAdminClient()
      .from("settings")
      .upsert({ key: "generation_enabled", value: enabled }, { onConflict: "key" });
    if (error) throw new Error(`set generation_enabled failed (${error.code})`);

    await audit({ actorId: user.id, action: "settings.generation", meta: { enabled } });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "setGenerationEnabled");
  }
}

// пустое поле — без лимита (null)
const optionalLimit = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.coerce.number().int().min(0).max(max).nullable());

const staffLimitsSchema = z.object({
  staff_daily_credits: optionalLimit(1_000_000),
  teacher_grant_max: optionalLimit(10_000),
  teacher_grant_daily: optionalLimit(1_000_000),
});

/** Потолки ведущих (миграция 20261116120000_staff_caps). Действуют сразу, без деплоя. */
export async function updateStaffLimits(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize(["admin"]);
    const parsed = staffLimitsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalid(parsed.error);
    const limits = parsed.data;

    const { error } = await createAdminClient()
      .from("settings")
      .upsert(
        STAFF_LIMIT_KEYS.map((key) => ({ key, value: limits[key] })),
        { onConflict: "key" },
      );
    if (error) throw new Error(`set staff limits failed (${error.code})`);

    await audit({ actorId: user.id, action: "settings.staff_limits", meta: limits });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "updateStaffLimits");
  }
}
