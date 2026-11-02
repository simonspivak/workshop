// Урок в том виде, в каком он уходит в браузер. Без правильных ответов и объяснений теста:
// их отдаёт только Server Action submitQuiz после отправки.

import type { JobAction } from "@/lib/platform/generation-types";

export type LessonAiAction = { type: JobAction; model: string; stars: number };

export type LessonTaskView = {
  id: string;
  n: number;
  title: string;
  mode: "solo" | "group";
  steps: string[];
  promptTemplates: string[];
  aiActions: LessonAiAction[];
  doneWhen: string | null;
};

export type LessonQuestionView = { question: string; options: string[] };

export type LessonView = {
  n: number;
  id: string;
  title: string;
  oneLiner: string;
  durationMin: number | null;
  goals: string[];
  outcome: string | null;
  theory: { heading: string; body: string; example: string | null }[];
  tasks: LessonTaskView[];
  quiz: LessonQuestionView[];
  homework: { title: string; steps: string[]; deliverable: string | null };
  safety: string[];
};

/** Шаги, которые отмечаются в lesson_progress: теория, каждое задание, тест, домашка. */
export const LESSON_STEP_THEORY = "theory";
export const LESSON_STEP_QUIZ = "quiz";
export const LESSON_STEP_HOMEWORK = "homework";

export type QuizResultView = {
  score: number;
  maxScore: number;
  bonus: number;
  /** тест уже был сдан раньше: показываем ту попытку */
  alreadyDone: boolean;
  /** демо ведущего: результат не записан */
  practice: boolean;
  items: { chosen: number; correctIndex: number; correct: boolean; explanation: string }[];
};
