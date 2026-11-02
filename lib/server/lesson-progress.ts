import "server-only";
import { getQuizKey, lessonProgressSteps } from "@/lib/server/course";
import type { SessionUser } from "@/lib/server/dal/auth";
import { JOB_COLUMNS, toJobViews, type JobRecord } from "@/lib/server/job-progress";
import { gradeQuiz } from "@/lib/server/quiz";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import type { JobView } from "@/lib/platform/generation-types";
import type { QuizResultView } from "@/lib/platform/lesson-types";

/*
  Состояние урока для ученика: отмеченные шаги (lesson_progress), засчитанная попытка теста
  (quiz_attempts) и свои результаты по заданиям урока. Чтение — через RLS, запись шагов —
  admin-клиентом (у клиентов нет прав на запись) после проверки шага по уроку.
*/

const RESULTS_PER_TASK = 6;

export type LessonState = {
  done: string[];
  quiz: QuizResultView | null;
  results: Record<string, JobView[]>;
};

export async function getLessonState(user: SessionUser, lessonId: string): Promise<LessonState> {
  const supabase = await createClient();
  const [progress, attempt, jobs] = await Promise.all([
    supabase.from("lesson_progress").select("step").eq("user_id", user.id).eq("lesson_id", lessonId),
    supabase
      .from("quiz_attempts")
      .select("answers, score, max_score, bonus")
      .eq("user_id", user.id)
      .eq("lesson_id", lessonId)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("user_id", user.id)
      .eq("lesson_id", lessonId)
      .not("task_ref", "is", null)
      .order("created_at", { ascending: false })
      .limit(80)
      .returns<JobRecord[]>(),
  ]);
  if (progress.error) throw new Error(`lessonProgress.state progress failed (${progress.error.code})`);
  if (attempt.error) throw new Error(`lessonProgress.state quiz failed (${attempt.error.code})`);
  if (jobs.error) throw new Error(`lessonProgress.state jobs failed (${jobs.error.code})`);

  const perTask = new Map<string, JobRecord[]>();
  for (const job of jobs.data ?? []) {
    const list = perTask.get(job.task_ref!) ?? [];
    if (list.length < RESULTS_PER_TASK) list.push(job);
    perTask.set(job.task_ref!, list);
  }
  const flat = [...perTask.values()].flat();
  const views = await toJobViews(flat);
  const results: Record<string, JobView[]> = {};
  flat.forEach((job, i) => (results[job.task_ref!] ??= []).push(views[i]));

  return {
    done: (progress.data ?? []).map((row) => row.step),
    quiz: attempt.data
      ? recordedQuizResult(lessonId, attempt.data.answers, attempt.data.score, attempt.data.max_score, attempt.data.bonus)
      : null,
    results,
  };
}

/** Засчитанная попытка → результат с объяснениями (ответы проверяются заново по ключу). */
export function recordedQuizResult(
  lessonId: string,
  answers: unknown,
  score: number,
  maxScore: number,
  bonus: number,
): QuizResultView {
  const key = getQuizKey(lessonId);
  const numbers = Array.isArray(answers) ? answers.map(Number) : [];
  const graded = key ? gradeQuiz(key, numbers) : null;
  return { score, maxScore, bonus, alreadyDone: true, practice: false, items: graded?.items ?? [] };
}

export function isLessonStep(lessonId: string, step: string): boolean {
  return lessonProgressSteps(lessonId).includes(step);
}

/** Отметить шаг урока (или снять отметку). Шаг «тест» ставит только submitQuiz. */
export async function setLessonStep(userId: string, lessonId: string, step: string, done: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = done
    ? await admin
        .from("lesson_progress")
        .upsert({ user_id: userId, lesson_id: lessonId, step }, { onConflict: "user_id,lesson_id,step", ignoreDuplicates: true })
    : await admin.from("lesson_progress").delete().eq("user_id", userId).eq("lesson_id", lessonId).eq("step", step);
  if (error) throw new Error(`lessonProgress.setLessonStep failed (${error.code})`);
}
