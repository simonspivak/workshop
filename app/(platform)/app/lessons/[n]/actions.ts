"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getQuizKey } from "@/lib/server/course";
import { AuthError, authorize, isStaff } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { isLessonStep, recordedQuizResult, setLessonStep } from "@/lib/server/lesson-progress";
import { gradeQuiz } from "@/lib/server/quiz";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { recordQuizAttempt } from "@/lib/server/wallet";
import { LESSON_STEP_QUIZ, type QuizResultView } from "@/lib/platform/lesson-types";
import type { GenerationErrorCode } from "@/lib/platform/generation-messages";
import type { ErrorCode } from "@/lib/platform/messages";

/*
  Действия урока. Каждое само проверяет вход (authorize) и валидирует ввод.
  submitQuiz проверяет ответы на сервере: правильные ответы в браузер не уходят,
  объяснения возвращаются только после отправки. Одна засчитанная попытка на урок,
  +20★ за ≥ 8 из 10 (record_quiz_attempt, через журнал звёзд). Ведущий проходит тест
  как тренировку: без записи и без бонуса.
*/

type Failure = { ok: false; error: ErrorCode | GenerationErrorCode };

export type QuizActionResult = { ok: true; result: QuizResultView } | Failure;
export type StepActionResult = { ok: true } | Failure;

const lessonIdSchema = z.string().regex(/^lesson-[0-9]{1,2}$/);

function fail(error: unknown, op: string): Failure {
  if (error instanceof AuthError) return { ok: false, error: error.code };
  if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
  console.error(`lessons.${op}: unexpected error`, { error: error instanceof Error ? error.message : String(error) });
  return { ok: false, error: "server_error" };
}

export async function submitQuiz(_prev: QuizActionResult | null, formData: FormData): Promise<QuizActionResult> {
  try {
    const user = await authorize();
    const lessonId = lessonIdSchema.safeParse(formData.get("lessonId"));
    const key = lessonId.success ? getQuizKey(lessonId.data) : null;
    if (!lessonId.success || !key) return { ok: false, error: "lesson_not_found" };

    const answers: number[] = [];
    for (let i = 0; i < key.length; i++) {
      const raw = formData.get(`q${i}`);
      if (typeof raw !== "string" || !/^[0-9]$/.test(raw)) return { ok: false, error: "quiz_incomplete" };
      answers.push(Number(raw));
    }
    const grade = gradeQuiz(key, answers);
    if (!grade) return { ok: false, error: "invalid_input" };

    if (isStaff(user)) {
      return { ok: true, result: { ...grade, bonus: 0, alreadyDone: false, practice: true } };
    }

    const recorded = await recordQuizAttempt({
      userId: user.id,
      lessonId: lessonId.data,
      answers,
      score: grade.score,
      maxScore: grade.maxScore,
      bonus: grade.bonus,
    });
    if (!recorded.ok) return { ok: false, error: recorded.error };
    await setLessonStep(user.id, lessonId.data, LESSON_STEP_QUIZ, true);
    refresh();

    if (recorded.alreadyDone) {
      // попытка уже была (второе окно, двойная отправка): показываем засчитанную
      const { data } = await createAdminClient()
        .from("quiz_attempts")
        .select("answers")
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId.data)
        .maybeSingle();
      return {
        ok: true,
        result: recordedQuizResult(lessonId.data, data?.answers ?? [], recorded.score, recorded.maxScore, recorded.bonus),
      };
    }
    return { ok: true, result: { ...grade, bonus: recorded.bonus, alreadyDone: false, practice: false } };
  } catch (error) {
    return fail(error, "submitQuiz");
  }
}

const stepSchema = z.object({
  lessonId: lessonIdSchema,
  step: z.string().regex(/^[a-z0-9_.:-]{1,60}$/),
  done: z.enum(["1", "0"]),
});

/** Отметить шаг урока (теория, задание, домашка) или снять отметку. */
export async function toggleLessonStep(_prev: StepActionResult | null, formData: FormData): Promise<StepActionResult> {
  try {
    const user = await authorize();
    const parsed = stepSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    const { lessonId, step, done } = parsed.data;
    if (step === LESSON_STEP_QUIZ || !isLessonStep(lessonId, step)) return { ok: false, error: "invalid_input" };
    await setLessonStep(user.id, lessonId, step, done === "1");
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "toggleLessonStep");
  }
}
