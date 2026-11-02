import "server-only";

/*
  Проверка теста урока (docs/platform/spec.md §4). Правильные ответы приходят из
  lib/server/course.ts (getQuizKey) и в браузер не уходят; сюда — только номера ответов ученика.
  Бонус +20★ за ≥ 8 из 10 (или та же доля, если вопросов не 10).
*/

export const QUIZ_BONUS_STARS = 20;
const BONUS_SHARE = { num: 8, den: 10 };

export type QuizKeyItem = { correctIndex: number; explanation: string; optionCount: number };

export type QuizItemResult = { chosen: number; correctIndex: number; correct: boolean; explanation: string };

export type QuizGrade = { score: number; maxScore: number; bonus: number; items: QuizItemResult[] };

/** Сколько правильных ответов нужно для бонуса: 8 из 10. */
export function quizBonusMinScore(maxScore: number): number {
  return Math.ceil((maxScore * BONUS_SHARE.num) / BONUS_SHARE.den);
}

export function quizBonus(score: number, maxScore: number): number {
  return maxScore > 0 && score >= quizBonusMinScore(maxScore) ? QUIZ_BONUS_STARS : 0;
}

/** null — ответов не столько, сколько вопросов, или номер ответа вне вариантов. */
export function gradeQuiz(key: QuizKeyItem[], answers: readonly number[]): QuizGrade | null {
  if (key.length === 0 || answers.length !== key.length) return null;
  const items: QuizItemResult[] = [];
  for (let i = 0; i < key.length; i++) {
    const chosen = answers[i];
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= key[i].optionCount) return null;
    items.push({
      chosen,
      correctIndex: key[i].correctIndex,
      correct: chosen === key[i].correctIndex,
      explanation: key[i].explanation,
    });
  }
  const score = items.filter((item) => item.correct).length;
  return { score, maxScore: key.length, bonus: quizBonus(score, key.length), items };
}
