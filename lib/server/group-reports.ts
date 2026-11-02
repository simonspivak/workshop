import "server-only";
import { listLessons, lessonProgressSteps } from "@/lib/server/course";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { listStudents } from "@/lib/server/dal/teacher";
import { createClient } from "@/lib/server/supabase/server";

/*
  Отчёт ведущего по группе (docs/platform/spec.md §7): прогресс по урокам, тесты, траты звёзд.
  Чтение — клиентом ведущего через RLS (видны только ученики его групп) постранично:
  PostgREST отдаёт не больше 1000 строк за запрос. Доступ к группе проверяет вызывающий (getGroup).
*/

const PAGE = 1000;
const MAX_ROWS = 50_000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

async function fetchAll<T>(load: (from: number, to: number) => Page<T>, op: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(`groupReports.${op} failed (${error.code})`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

export type ReportLesson = { id: string; n: number; title: string; steps: number };

export type ReportStudent = {
  id: string;
  login: string | null;
  nickname: string;
  balance: number;
  progress: Record<string, number>;
  quiz: Record<string, { score: number; maxScore: number; bonus: number } | undefined>;
  spent: { total: number; today: number; generations: number; refunds: number; botReplies: number };
};

export type GroupReport = {
  lessons: ReportLesson[];
  students: ReportStudent[];
  totals: { spentToday: number; spentTotal: number; quizBonus: number };
};

export async function getGroupReport(user: SessionUser, groupId: string): Promise<GroupReport> {
  if (!isStaff(user)) throw new AuthError("forbidden");
  const lessons = listLessons().map((lesson) => ({
    id: lesson.id,
    n: lesson.n,
    title: lesson.title,
    steps: lessonProgressSteps(lesson.id).length,
  }));
  const students = await listStudents(user, groupId);
  if (students.length === 0) return { lessons, students: [], totals: { spentToday: 0, spentTotal: 0, quizBonus: 0 } };

  const ids = students.map((s) => s.id);
  const supabase = await createClient();
  const [progress, attempts, ledger] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase.from("lesson_progress").select("user_id, lesson_id, step").in("user_id", ids).order("user_id").range(from, to),
      "progress",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("quiz_attempts")
          .select("user_id, lesson_id, score, max_score, bonus")
          .in("user_id", ids)
          .order("user_id")
          .range(from, to),
      "quiz",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("star_ledger")
          .select("id, user_id, delta, reason, created_at")
          .in("user_id", ids)
          .in("reason", ["debit", "refund", "bot_reply"])
          .order("id")
          .range(from, to),
      "ledger",
    ),
  ]);

  const today = berlinDay.format(new Date());
  const byId = new Map<string, ReportStudent>(
    students.map((s) => [
      s.id,
      {
        id: s.id,
        login: s.login,
        nickname: s.nickname,
        balance: s.balance,
        progress: {},
        quiz: {},
        spent: { total: 0, today: 0, generations: 0, refunds: 0, botReplies: 0 },
      },
    ]),
  );

  for (const row of progress) {
    const student = byId.get(row.user_id);
    if (student) student.progress[row.lesson_id] = (student.progress[row.lesson_id] ?? 0) + 1;
  }
  let quizBonus = 0;
  for (const row of attempts) {
    const student = byId.get(row.user_id);
    if (!student) continue;
    student.quiz[row.lesson_id] = { score: row.score, maxScore: row.max_score, bonus: row.bonus };
    quizBonus += row.bonus;
  }
  let spentToday = 0;
  let spentTotal = 0;
  for (const row of ledger) {
    const student = byId.get(row.user_id);
    if (!student) continue;
    const spent = -row.delta; // списание отрицательное, возврат положительный
    student.spent.total += spent;
    spentTotal += spent;
    if (berlinDay.format(new Date(row.created_at)) === today) {
      student.spent.today += spent;
      spentToday += spent;
    }
    if (row.reason === "debit") student.spent.generations += 1;
    if (row.reason === "refund") student.spent.refunds += 1;
    if (row.reason === "bot_reply") student.spent.botReplies += 1;
  }

  return { lessons, students: [...byId.values()], totals: { spentToday, spentTotal, quizBonus } };
}
