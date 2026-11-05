// Урок в том виде, в каком он уходит в браузер. Без правильных ответов и объяснений теста:
// их отдаёт только Server Action submitQuiz после отправки.

import type { GenerateAction, JobAction } from "@/lib/platform/generation-types";

export type LessonAiAction = { type: JobAction; model: string; stars: number };

/**
 * Шаг задания или домашки. В JSON шаг — строка или { text, prompt?, tip? }; сюда приходит
 * всегда объект. prompt показывается рамкой «Промпт N» (N — по порядку в задании), tip — заметкой.
 */
/** Шаг задания. into — в какое ИИ-действие задания вставлять промпт (по умолчанию в чат). */
export type LessonStepView = { text: string; prompt: string | null; tip: string | null; into: GenerateAction | null };

/** Инструмент урока: внешний сервис, которым можно пользоваться и после курса. */
export type LessonToolView = { name: string; url: string; what: string; cost: string | null; age: string | null };

export type LessonTaskView = {
  id: string;
  n: number;
  title: string;
  mode: "solo" | "group";
  /** 1–2 предложения «зачем это задание» */
  intro: string | null;
  steps: LessonStepView[];
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
  homework: { title: string; intro: string | null; steps: LessonStepView[]; deliverable: string | null };
  tools: LessonToolView[];
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
