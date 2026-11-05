import "server-only";
import { z } from "zod";
import lesson1 from "@/docs/course/lesson-1.json";
import lesson2 from "@/docs/course/lesson-2.json";
import lesson3 from "@/docs/course/lesson-3.json";
import lesson4 from "@/docs/course/lesson-4.json";
import lesson5 from "@/docs/course/lesson-5.json";
import {
  LESSON_STEP_HOMEWORK,
  LESSON_STEP_QUIZ,
  LESSON_STEP_THEORY,
  type LessonStepView,
  type LessonView,
} from "@/lib/platform/lesson-types";
import type { QuizKeyItem } from "@/lib/server/quiz";

/*
  Уроки курса из docs/course/lesson-*.json (схема — docs/platform/spec.md §4). Модуль только
  для сервера: в JSON лежат правильные ответы тестов (quiz[].correctIndex), они никогда не уходят
  в браузер. Наружу — только выжимки (LessonView), без correctIndex и без объяснений; объяснения
  отдаёт submitQuiz после отправки. JSON проверяется схемой при загрузке: ошибка в уроке
  ломает сборку, а не страницу у ученика.
*/

const text = z.string().trim().min(1);

// Шаг: строка (старый формат) или { text, prompt?, tip? }. Лишние поля отбрасываются.
const step = z.union([text, z.object({ text, prompt: text.optional(), tip: text.optional() })]);

// Только https: ссылка уходит в href, javascript: и прочие схемы не пропускаем
const httpsUrl = z
  .string()
  .trim()
  .refine((value) => /^https:\/\/\S+$/.test(value) && URL.canParse(value), { message: "https link expected" });

const lessonSchema = z.object({
  id: z.string().regex(/^lesson-[0-9]{1,2}$/),
  order: z.number().int().min(1).max(99),
  title: text,
  oneLiner: z.string().optional(),
  durationMin: z.number().int().positive().optional(),
  goals: z.array(text).default([]),
  outcome: z.string().optional(),
  timeline: z
    .array(z.object({ minutes: z.number(), block: text, teacherNotes: z.string().default("") }))
    .default([]),
  theory: z.array(z.object({ heading: text, body: text, example: z.string().optional() })).default([]),
  tasks: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,60}$/),
        title: text,
        mode: z.enum(["solo", "group"]).default("solo"),
        intro: text.optional(),
        steps: z.array(step).default([]),
        promptTemplates: z.array(text).default([]),
        aiActions: z
          .array(
            z.object({
              type: z.enum(["text", "image", "image_edit", "video", "motion", "lipsync", "voice", "music", "montage"]),
              model: text,
              stars: z.number().int().min(0),
            }),
          )
          .default([]),
        doneWhen: z.string().optional(),
      }),
    )
    .default([]),
  quiz: z
    .array(
      z
        .object({
          question: text,
          options: z.array(text).min(2).max(8),
          correctIndex: z.number().int().min(0),
          explanation: z.string().default(""),
        })
        .refine((q) => q.correctIndex < q.options.length, { message: "correctIndex out of range" }),
    )
    .default([]),
  homework: z.object({
    title: text,
    intro: text.optional(),
    steps: z.array(step).default([]),
    deliverable: z.string().optional(),
  }),
  tools: z
    .array(z.object({ name: text, url: httpsUrl, what: text, cost: text.optional(), age: text.optional() }))
    .default([]),
  safety: z.array(text).default([]),
  materials: z.array(text).default([]),
});

type LessonSource = z.infer<typeof lessonSchema>;

function toStep(source: z.infer<typeof step>): LessonStepView {
  return typeof source === "string"
    ? { text: source, prompt: null, tip: null }
    : { text: source.text, prompt: source.prompt ?? null, tip: source.tip ?? null };
}

const LESSONS: LessonSource[] = [lesson1, lesson2, lesson3, lesson4, lesson5]
  .map((raw) => lessonSchema.parse(raw))
  .sort((a, b) => a.order - b.order);

export type LessonSummary = { n: number; id: string; title: string; oneLiner: string };

export function listLessons(): LessonSummary[] {
  return LESSONS.map((lesson) => ({
    n: lesson.order,
    id: lesson.id,
    title: lesson.title,
    oneLiner: lesson.oneLiner ?? "",
  }));
}

function toView(lesson: LessonSource): LessonView {
  return {
    n: lesson.order,
    id: lesson.id,
    title: lesson.title,
    oneLiner: lesson.oneLiner ?? "",
    durationMin: lesson.durationMin ?? null,
    goals: lesson.goals,
    outcome: lesson.outcome ?? null,
    theory: lesson.theory.map((t) => ({ heading: t.heading, body: t.body, example: t.example ?? null })),
    tasks: lesson.tasks.map((task, i) => ({
      id: task.id,
      n: i + 1,
      title: task.title,
      mode: task.mode,
      intro: task.intro ?? null,
      steps: task.steps.map(toStep),
      promptTemplates: task.promptTemplates,
      aiActions: task.aiActions.map((a) => ({ type: a.type, model: a.model, stars: a.stars })),
      doneWhen: task.doneWhen ?? null,
    })),
    // только вопрос и варианты: correctIndex и explanation остаются на сервере
    quiz: lesson.quiz.map((q) => ({ question: q.question, options: q.options })),
    homework: {
      title: lesson.homework.title,
      intro: lesson.homework.intro ?? null,
      steps: lesson.homework.steps.map(toStep),
      deliverable: lesson.homework.deliverable ?? null,
    },
    tools: lesson.tools.map((t) => ({ name: t.name, url: t.url, what: t.what, cost: t.cost ?? null, age: t.age ?? null })),
    safety: lesson.safety,
  };
}

const findByNumber = (n: number) => LESSONS.find((lesson) => lesson.order === n);
const findById = (id: string) => LESSONS.find((lesson) => lesson.id === id);

export function getLessonByNumber(n: number): LessonView | null {
  const lesson = findByNumber(n);
  return lesson ? toView(lesson) : null;
}

export function getLessonById(id: string): LessonView | null {
  const lesson = findById(id);
  return lesson ? toView(lesson) : null;
}

export function lessonNumber(id: string): number | null {
  return findById(id)?.order ?? null;
}

export function lessonHasTask(lessonId: string, taskId: string): boolean {
  return Boolean(findById(lessonId)?.tasks.some((task) => task.id === taskId));
}

/** Шаги для lesson_progress: теория, задания (по id), тест, домашка. */
export function lessonProgressSteps(lessonId: string): string[] {
  const lesson = findById(lessonId);
  if (!lesson) return [];
  return [
    ...(lesson.theory.length ? [LESSON_STEP_THEORY] : []),
    ...lesson.tasks.map((task) => task.id),
    ...(lesson.quiz.length ? [LESSON_STEP_QUIZ] : []),
    LESSON_STEP_HOMEWORK,
  ];
}

/** План урока и материалы — только для ведущего. */
export function getLessonStaffNotes(
  lessonId: string,
): { timeline: { minutes: number; block: string; teacherNotes: string }[]; materials: string[] } | null {
  const lesson = findById(lessonId);
  return lesson ? { timeline: lesson.timeline, materials: lesson.materials } : null;
}

/** Ключ теста — только для проверки на сервере (lib/server/quiz.ts). */
export function getQuizKey(lessonId: string): QuizKeyItem[] | null {
  const lesson = findById(lessonId);
  if (!lesson || lesson.quiz.length === 0) return null;
  return lesson.quiz.map((q) => ({ correctIndex: q.correctIndex, explanation: q.explanation, optionCount: q.options.length }));
}
