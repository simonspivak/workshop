import "server-only";
import { listLessons, lessonProgressSteps } from "@/lib/server/course";
import { AuthError, isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { assertTeachesGroup, listStudents, teacherRpcError } from "@/lib/server/dal/teacher";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { fetchAll } from "@/lib/server/supabase/paging";
import { createClient } from "@/lib/server/supabase/server";

/*
  Отчёт ведущего по группе (docs/platform/spec.md §7): прогресс по урокам, тесты, траты звёзд.
  Траты и прогресс суммирует SQL (group_report_spending, group_report_progress; аудит № 15):
  раньше сервер читал весь журнал звёзд строками через RLS, 1000 строк за запрос, и на группе
  в 50 человек отчёт мог не успеть открыться. SQL-функции сами проверяют, что пользователь
  ведёт группу (или админ); здесь та же проверка ещё раз — assertTeachesGroup.
  Тесты (≤ ученики × уроки строк) читаются клиентом ведущего через RLS, постранично.
*/

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
  await assertTeachesGroup(user, groupId);

  // Пары (урок, шаг) текущей версии уроков: строки под старыми id заданий (после переименования)
  // SQL не считает, иначе отчёт показывает «9/6». Так же считает страница урока у ученика.
  const lessonIds: string[] = [];
  const stepIds: string[] = [];
  const lessons = listLessons().map((lesson) => {
    const steps = lessonProgressSteps(lesson.id);
    for (const step of steps) {
      lessonIds.push(lesson.id);
      stepIds.push(step);
    }
    return { id: lesson.id, n: lesson.n, title: lesson.title, steps: steps.length };
  });
  const students = await listStudents(user, groupId);
  if (students.length === 0) return { lessons, students: [], totals: { spentToday: 0, spentTotal: 0, quizBonus: 0 } };

  const ids = students.map((s) => s.id);
  const admin = createAdminClient();
  const supabase = await createClient();
  const [progress, spending, attempts] = await Promise.all([
    admin
      .rpc("group_report_progress", { p_actor: user.id, p_group: groupId, p_lessons: lessonIds, p_steps: stepIds })
      .then(({ data, error }) => {
        if (error) throw teacherRpcError(error, "groupReports.progress");
        return data ?? [];
      }),
    admin.rpc("group_report_spending", { p_actor: user.id, p_group: groupId }).then(({ data, error }) => {
      if (error) throw teacherRpcError(error, "groupReports.spending");
      return data ?? [];
    }),
    fetchAll(
      (from, to) =>
        supabase
          .from("quiz_attempts")
          .select("id, user_id, lesson_id, score, max_score, bonus")
          .in("user_id", ids)
          .order("id")
          .range(from, to),
      "groupReports.quiz",
    ),
  ]);

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
    if (student) student.progress[row.lesson_id] = Number(row.steps);
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
  for (const row of spending) {
    const student = byId.get(row.user_id);
    if (!student) continue;
    student.spent = {
      total: Number(row.spent_total),
      today: Number(row.spent_today),
      generations: Number(row.generations),
      refunds: Number(row.refunds),
      botReplies: Number(row.bot_replies),
    };
    spentTotal += student.spent.total;
    spentToday += student.spent.today;
  }

  return { lessons, students: [...byId.values()], totals: { spentToday, spentTotal, quizBonus } };
}
