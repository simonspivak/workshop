import "server-only";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import type { AgeBand, GroupKind } from "@/lib/server/supabase/types";

/*
  Данные кабинета учителя. Чтение — клиентом пользователя (RLS: учитель видит только свои
  группы, админ — все) плюс явная проверка роли. Проверки для Server Actions —
  assertTeachesGroup / assertTeachesStudent (admin-клиент + сравнение teacher_id).
*/

export type GroupSummary = {
  id: string;
  code: string;
  title: string;
  kind: GroupKind;
  paused: boolean;
  endsOn: string | null;
  budgetStars: number | null;
  plannedStudents: number | null;
  starsPerStudent: number | null;
  allowGoogleMinors: boolean;
  shareGallery: boolean;
  studentCount: number;
  teacherId: string;
};

export type StudentRow = {
  id: string;
  login: string | null;
  nickname: string;
  ageBand: AgeBand;
  consentAt: string | null;
  disabled: boolean;
  balance: number;
  createdAt: string;
};

const GROUP_COLUMNS =
  "id, code, title, kind, paused, ends_on, budget_stars, planned_students, stars_per_student, allow_google_minors, share_gallery, teacher_id, created_at";

type GroupDbRow = {
  id: string;
  code: string;
  title: string;
  kind: GroupKind;
  paused: boolean;
  ends_on: string | null;
  budget_stars: number | null;
  planned_students: number | null;
  stars_per_student: number | null;
  allow_google_minors: boolean;
  share_gallery: boolean;
  teacher_id: string;
};

function toSummary(row: GroupDbRow, studentCount: number): GroupSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    kind: row.kind,
    paused: row.paused,
    endsOn: row.ends_on,
    budgetStars: row.budget_stars,
    plannedStudents: row.planned_students,
    starsPerStudent: row.stars_per_student,
    allowGoogleMinors: row.allow_google_minors,
    shareGallery: row.share_gallery,
    studentCount,
    teacherId: row.teacher_id,
  };
}

function assertStaff(user: SessionUser) {
  if (!isStaff(user)) throw new AuthError("forbidden");
}

/** Группы учителя (у админа — все), новые сверху. */
export async function listGroups(user: SessionUser): Promise<GroupSummary[]> {
  assertStaff(user);
  const supabase = await createClient();
  let query = supabase.from("groups").select(GROUP_COLUMNS).order("created_at", { ascending: false });
  if (user.role !== "admin") query = query.eq("teacher_id", user.id);
  const { data: groups, error } = await query.returns<GroupDbRow[]>();
  if (error) throw new Error(`teacher.listGroups failed (${error.code})`);
  if (!groups?.length) return [];

  const { data: members, error: membersError } = await supabase
    .from("profiles")
    .select("group_id")
    .eq("role", "student")
    .in(
      "group_id",
      groups.map((g) => g.id),
    );
  if (membersError) throw new Error(`teacher.listGroups members failed (${membersError.code})`);
  const counts = new Map<string, number>();
  for (const m of members ?? []) if (m.group_id) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);

  return groups.map((g) => toSummary(g, counts.get(g.id) ?? 0));
}

/** Группа, если пользователь её ведёт (или админ). null — нет такой или чужая. */
export async function getGroup(user: SessionUser, groupId: string): Promise<GroupSummary | null> {
  assertStaff(user);
  if (!isUuid(groupId)) return null;
  const supabase = await createClient();
  const { data: group, error } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("id", groupId)
    .maybeSingle<GroupDbRow>();
  if (error) throw new Error(`teacher.getGroup failed (${error.code})`);
  if (!group || (user.role !== "admin" && group.teacher_id !== user.id)) return null;

  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("role", "student");
  return toSummary(group, count ?? 0);
}

/** Ученики группы с балансом. Вызывать после getGroup (проверка доступа). */
export async function listStudents(user: SessionUser, groupId: string): Promise<StudentRow[]> {
  assertStaff(user);
  const supabase = await createClient();
  const { data: students, error } = await supabase
    .from("profiles")
    .select("id, login, nickname, age_band, parental_consent_at, disabled, created_at")
    .eq("group_id", groupId)
    .eq("role", "student")
    .order("login", { ascending: true });
  if (error) throw new Error(`teacher.listStudents failed (${error.code})`);
  if (!students?.length) return [];

  const { data: wallets, error: walletsError } = await supabase
    .from("wallets")
    .select("user_id, balance")
    .in(
      "user_id",
      students.map((s) => s.id),
    );
  if (walletsError) throw new Error(`teacher.listStudents wallets failed (${walletsError.code})`);
  const balances = new Map((wallets ?? []).map((w) => [w.user_id, w.balance]));

  return students.map((s) => ({
    id: s.id,
    login: s.login,
    nickname: s.nickname,
    ageBand: s.age_band,
    consentAt: s.parental_consent_at,
    disabled: s.disabled,
    balance: balances.get(s.id) ?? 0,
    createdAt: s.created_at,
  }));
}

export type GroupStarStats = { given: number; spent: number };

/** Сколько звёзд роздано ученикам группы и сколько они потратили. Вызывать после getGroup. */
export async function getGroupStarStats(user: SessionUser, groupId: string): Promise<GroupStarStats> {
  assertStaff(user);
  const admin = createAdminClient();
  const { data: students, error } = await admin
    .from("profiles")
    .select("id")
    .eq("group_id", groupId)
    .eq("role", "student");
  if (error) throw new Error(`teacher.getGroupStarStats failed (${error.code})`);
  if (!students?.length) return { given: 0, spent: 0 };

  const { data: rows, error: ledgerError } = await admin
    .from("star_ledger")
    .select("delta, reason")
    .in(
      "user_id",
      students.map((s) => s.id),
    );
  if (ledgerError) throw new Error(`teacher.getGroupStarStats ledger failed (${ledgerError.code})`);

  let given = 0;
  let spent = 0;
  for (const row of rows ?? []) {
    if (row.reason === "debit" || row.reason === "bot_reply" || row.reason === "refund") spent -= row.delta;
    else given += row.delta;
  }
  return { given, spent: Math.max(0, spent) };
}

// ---------- проверки для Server Actions ----------

export type OwnedGroup = { id: string; code: string; title: string; teacherId: string };

/** Группа существует и пользователь её ведёт (или он админ). Иначе AuthError('forbidden'). */
export async function assertTeachesGroup(user: SessionUser, groupId: string): Promise<OwnedGroup> {
  assertStaff(user);
  if (!isUuid(groupId)) throw new AuthError("forbidden");
  const { data, error } = await createAdminClient()
    .from("groups")
    .select("id, code, title, teacher_id")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error(`teacher.assertTeachesGroup failed (${error.code})`);
  if (!data || (user.role !== "admin" && data.teacher_id !== user.id)) throw new AuthError("forbidden");
  return { id: data.id, code: data.code, title: data.title, teacherId: data.teacher_id };
}

/** Ученик существует, это ученик (не учитель) и он в группе этого учителя. */
export async function assertTeachesStudent(
  user: SessionUser,
  studentId: string,
): Promise<{ student: { id: string; login: string | null; groupId: string; consentAt: string | null }; group: OwnedGroup }> {
  assertStaff(user);
  if (!isUuid(studentId)) throw new AuthError("forbidden");
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, login, role, group_id, parental_consent_at")
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw new Error(`teacher.assertTeachesStudent failed (${error.code})`);
  if (!data || data.role !== "student" || !data.group_id) throw new AuthError("forbidden");
  const group = await assertTeachesGroup(user, data.group_id);
  return {
    student: { id: data.id, login: data.login, groupId: data.group_id, consentAt: data.parental_consent_at },
    group,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
