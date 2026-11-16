import "server-only";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import { getPriceList } from "@/lib/server/prices";
import type { AgeBand, ConsentMethod, GroupKind } from "@/lib/server/supabase/types";

/*
  Данные кабинета учителя. Учеников, кошельки и задачи читаем клиентом пользователя (RLS:
  учитель видит только свои группы, админ — все) плюс явная проверка роли. Группы — admin-клиентом
  с фильтром teacher_id: клиентам открыты только колонки группы, которые нужны ученику
  (аудит № 57, миграция 20261116190000_privacy), а бюджет видит только ведущий.
  Проверки для Server Actions — assertTeachesGroup / assertTeachesStudent (admin-клиент + сравнение teacher_id).
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
  /** как получено согласие (аудит № 25); null — не указано (отмечено до 16 ноября 2026) */
  consentMethod: ConsentMethod | null;
  /** кто отметил согласие: ник ведущего или админа; null — не записано */
  consentBy: string | null;
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
  let query = createAdminClient().from("groups").select(GROUP_COLUMNS).order("created_at", { ascending: false });
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
  const { data: group, error } = await createAdminClient()
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
    .select("id, login, nickname, age_band, parental_consent_at, parental_consent_method, parental_consent_by, disabled, created_at")
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
  const recorders = await staffNicknames(students.map((s) => s.parental_consent_by));

  return students.map((s) => ({
    id: s.id,
    login: s.login,
    nickname: s.nickname,
    ageBand: s.age_band,
    consentAt: s.parental_consent_at,
    consentMethod: s.parental_consent_method,
    consentBy: s.parental_consent_by ? (recorders.get(s.parental_consent_by) ?? "—") : null,
    disabled: s.disabled,
    balance: balances.get(s.id) ?? 0,
    createdAt: s.created_at,
  }));
}

/**
 * Ники ведущих и админов, отметивших согласие. Admin-клиентом: ведущий через RLS не видит
 * профиль админа. Только staff — ники учеников сюда не попадут.
 */
async function staffNicknames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, nickname")
    .in("id", unique)
    .in("role", ["teacher", "admin"]);
  if (error) throw new Error(`teacher.staffNicknames failed (${error.code})`);
  return new Map((data ?? []).map((p) => [p.id, p.nickname]));
}

/**
 * given — всё начисленное ученикам группы (стартовые, ведущим, бонусы тестов, минус снятия);
 * handed — то же без бонусов тестов (его сравниваем с бюджетом); spent — траты за вычетом возвратов.
 */
export type GroupStarStats = { given: number; handed: number; spent: number };

/** RPC-агрегатов кабинета отвечают 'forbidden', если пользователь не ведёт группу. */
export function teacherRpcError(error: { message?: string; code?: string }, op: string): Error {
  if (error.message === "forbidden") return new AuthError("forbidden");
  return new Error(`${op} failed (${error.code})`);
}

/**
 * Сколько звёзд роздано ученикам группы и сколько они потратили. Суммирует SQL
 * (group_star_stats): чтение строк журнала обрезалось бы на 1000 (аудит № 14).
 * SQL сам проверяет, что пользователь ведёт группу или админ.
 */
export async function getGroupStarStats(user: SessionUser, groupId: string): Promise<GroupStarStats> {
  assertStaff(user);
  const { data, error } = await createAdminClient().rpc("group_star_stats", { p_actor: user.id, p_group: groupId });
  if (error) throw teacherRpcError(error, "teacher.getGroupStarStats");
  const row = data?.[0];
  return { given: Number(row?.given ?? 0), handed: Number(row?.handed ?? 0), spent: Number(row?.spent ?? 0) };
}

/** Самая дешёвая цена видео для ученика — порог «мало звёзд» в списке учеников. */
export async function lowBalanceThreshold(): Promise<number> {
  const prices = await getPriceList();
  const video = prices.filter((p) => p.action === "video" && p.access === "all").map((p) => p.stars);
  return video.length ? Math.min(...video) : 25;
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
): Promise<{ student: TaughtStudent; group: OwnedGroup }> {
  assertStaff(user);
  if (!isUuid(studentId)) throw new AuthError("forbidden");
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, login, nickname, role, group_id, age_band, parental_consent_at, parental_consent_method, parental_consent_by")
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw new Error(`teacher.assertTeachesStudent failed (${error.code})`);
  if (!data || data.role !== "student" || !data.group_id) throw new AuthError("forbidden");
  const group = await assertTeachesGroup(user, data.group_id);
  return {
    student: {
      id: data.id,
      login: data.login,
      nickname: data.nickname,
      groupId: data.group_id,
      ageBand: data.age_band,
      consentAt: data.parental_consent_at,
      consentMethod: data.parental_consent_method,
      consentBy: data.parental_consent_by,
    },
    group,
  };
}

export type TaughtStudent = {
  id: string;
  login: string | null;
  nickname: string;
  groupId: string;
  ageBand: AgeBand;
  consentAt: string | null;
  consentMethod: ConsentMethod | null;
  consentBy: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
