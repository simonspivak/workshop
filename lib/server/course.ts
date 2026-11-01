import "server-only";
import lesson1 from "@/docs/course/lesson-1.json";
import lesson2 from "@/docs/course/lesson-2.json";
import lesson3 from "@/docs/course/lesson-3.json";
import lesson4 from "@/docs/course/lesson-4.json";

/*
  Уроки курса из docs/course/lesson-*.json. Модуль только для сервера: в JSON лежат
  правильные ответы тестов (quiz[].correctIndex), они никогда не уходят в браузер.
  Наружу — только безопасные выжимки.
*/

type LessonSource = { id: string; order: number; title: string; oneLiner?: string };

const SOURCES: LessonSource[] = [lesson1, lesson2, lesson3, lesson4];

export type LessonSummary = { n: number; id: string; title: string; oneLiner: string };

export function listLessons(): LessonSummary[] {
  return SOURCES.map((lesson) => ({
    n: lesson.order,
    id: lesson.id,
    title: lesson.title,
    oneLiner: lesson.oneLiner ?? "",
  })).sort((a, b) => a.n - b.n);
}
