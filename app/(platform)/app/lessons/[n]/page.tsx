import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { QuizForm } from "./QuizForm";
import { StepToggle } from "./StepToggle";
import { LessonTaskTools } from "@/components/platform/LessonTaskTools";
import { Badge, Card, Container, Notice, PageTitle, Skeleton } from "@/components/platform/ui";
import { getLessonByNumber, getLessonStaffNotes, lessonProgressSteps, listLessons } from "@/lib/server/course";
import { isStaff, requireUser } from "@/lib/server/dal/auth";
import { listMotionLibrary, listReferenceOptions } from "@/lib/server/gallery";
import { describeLessonActions } from "@/lib/server/generate-options";
import { getLessonState } from "@/lib/server/lesson-progress";
import { QUIZ_BONUS_STARS, quizBonusMinScore } from "@/lib/server/quiz";
import { LESSON_STEP_HOMEWORK, LESSON_STEP_THEORY, type LessonView } from "@/lib/platform/lesson-types";

export const metadata: Metadata = { title: "Урок" };

// Уроки известны заранее: заголовок урока входит в статичную оболочку, на неизвестный номер — «не найдено».
// Всё, что зависит от ученика (прогресс, цены, результаты, тест), — за Suspense.
export function generateStaticParams() {
  return listLessons().map((lesson) => ({ n: String(lesson.n) }));
}

export default async function LessonPage({ params }: PageProps<"/app/lessons/[n]">) {
  const { n } = await params;
  const lesson = /^[0-9]{1,2}$/.test(n) ? getLessonByNumber(Number(n)) : null;
  if (!lesson) notFound();

  return (
    <Container>
      <Link href="/app" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> В кабинет
      </Link>
      <PageTitle eyebrow={`Урок ${lesson.n}${lesson.durationMin ? ` · ${lesson.durationMin} мин` : ""}`} title={lesson.title}>
        {lesson.oneLiner}
      </PageTitle>
      <Suspense fallback={<LessonSkeleton />}>
        <Lesson lesson={lesson} />
      </Suspense>
    </Container>
  );
}

async function Lesson({ lesson }: { lesson: LessonView }) {
  const user = await requireUser();
  const staff = isStaff(user);
  const usesMotion = lesson.tasks.some((task) => task.aiActions.some((a) => a.type === "motion"));
  const library = usesMotion ? await listMotionLibrary() : [];
  const [state, actions, references] = await Promise.all([
    getLessonState(user, lesson.id),
    describeLessonActions(user, lesson, { motionLibraryEmpty: library.length === 0 }),
    listReferenceOptions(user),
  ]);

  const steps = lessonProgressSteps(lesson.id);
  const done = new Set(state.done);
  const doneCount = steps.filter((step) => done.has(step)).length;
  const notes = staff ? getLessonStaffNotes(lesson.id) : null;
  const all = listLessons();
  const index = all.findIndex((l) => l.id === lesson.id);
  const prev = all[index - 1];
  const next = all[index + 1];

  return (
    <article>
      <div className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <ProgressBar value={doneCount} max={steps.length} />
          <span className="font-mono text-sm text-ink-soft">
            Сделано {doneCount} из {steps.length}
          </span>
        </div>
        {staff && (
          <Notice>Демо-режим ведущего: все модели шлюза без звёзд, модель можно выбрать в форме. Задачи пишутся в журнал.</Notice>
        )}
        {!staff && user.group?.paused && (
          <Notice tone="warn">Ведущий поставил группу на паузу: генерации временно недоступны.</Notice>
        )}
      </div>

      <nav aria-label="Разделы урока" className="mb-8 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {[
          ...(lesson.theory.length ? [{ href: "#theory", label: "Теория" }] : []),
          ...lesson.tasks.map((task) => ({ href: `#${task.id}`, label: `Задание ${task.n}` })),
          ...(lesson.quiz.length ? [{ href: "#quiz", label: "Тест" }] : []),
          { href: "#homework", label: "Домашка" },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-ink/10 hover:bg-lavender"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {(lesson.goals.length > 0 || lesson.outcome) && (
          <Card title="Что получится">
            {lesson.goals.length > 0 && (
              <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
                {lesson.goals.map((goal, i) => (
                  <li key={i}>{goal}</li>
                ))}
              </ul>
            )}
            {lesson.outcome && <p className="mt-4 rounded-2xl bg-lavender p-4 leading-relaxed">{lesson.outcome}</p>}
          </Card>
        )}

        {lesson.safety.length > 0 && (
          <details className="group rounded-3xl bg-white ring-1 ring-ink/10">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
              <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-violet" />
              <span className="flex-1">Правила урока</span>
              <span className="text-sm text-violet group-open:hidden">Показать</span>
              <span className="hidden text-sm text-violet group-open:inline">Свернуть</span>
            </summary>
            <ul className="list-disc space-y-1.5 px-5 pb-5 pl-10 leading-relaxed sm:px-6 sm:pl-11">
              {lesson.safety.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </details>
        )}

        {lesson.theory.length > 0 && (
          <section id="theory" aria-labelledby="theory-title" className="space-y-4">
            <h2 id="theory-title" className="pt-4 text-2xl font-bold">
              Теория
            </h2>
            {lesson.theory.map((block, i) => (
              <Card key={i} title={block.heading}>
                <p className="leading-relaxed whitespace-pre-line">{block.body}</p>
                {block.example && (
                  <div className="mt-4 rounded-2xl bg-lavender p-4">
                    <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Пример</p>
                    <p className="mt-1 leading-relaxed whitespace-pre-line">{block.example}</p>
                  </div>
                )}
              </Card>
            ))}
            <StepToggle lessonId={lesson.id} step={LESSON_STEP_THEORY} done={done.has(LESSON_STEP_THEORY)} label="Теорию прочитал(а)" />
          </section>
        )}

        <section aria-labelledby="tasks-title" className="space-y-4">
          <h2 id="tasks-title" className="pt-4 text-2xl font-bold">
            Задания
          </h2>
          {lesson.tasks.map((task) => (
            <section
              key={task.id}
              id={task.id}
              aria-labelledby={`${task.id}-title`}
              className="rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-soft">Задание {task.n}</span>
                <Badge>{task.mode === "group" ? "в группе" : "соло"}</Badge>
                {done.has(task.id) && <Badge tone="violet">сделано</Badge>}
              </p>
              <h3 id={`${task.id}-title`} className="mt-2 text-xl font-semibold">
                {task.title}
              </h3>
              {task.steps.length > 0 && (
                <ol className="mt-4 list-decimal space-y-2 pl-5 leading-relaxed marker:font-mono marker:text-ink-soft">
                  {task.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
              {task.doneWhen && (
                <p className="mt-4 rounded-2xl bg-sun/30 px-4 py-3 text-sm leading-relaxed">
                  <span className="font-semibold">Готово, когда: </span>
                  {task.doneWhen}
                </p>
              )}
              <div className="mt-5">
                <LessonTaskTools
                  lessonId={lesson.id}
                  taskId={task.id}
                  templates={task.promptTemplates}
                  options={actions[task.id] ?? []}
                  montage={task.aiActions.some((a) => a.type === "montage")}
                  results={state.results[task.id] ?? []}
                  references={references}
                  library={library}
                  staff={staff}
                />
              </div>
              <div className="mt-5 border-t border-ink/10 pt-4">
                <StepToggle lessonId={lesson.id} step={task.id} done={done.has(task.id)} label="Задание выполнено" />
              </div>
            </section>
          ))}
        </section>

        {lesson.quiz.length > 0 && (
          <section id="quiz" aria-labelledby="quiz-title" className="space-y-4">
            <h2 id="quiz-title" className="pt-4 text-2xl font-bold">
              Тест
            </h2>
            <QuizForm
              lessonId={lesson.id}
              questions={lesson.quiz}
              initial={state.quiz}
              bonus={{ stars: QUIZ_BONUS_STARS, minScore: quizBonusMinScore(lesson.quiz.length) }}
            />
          </section>
        )}

        <section id="homework" aria-labelledby="homework-title" className="space-y-4">
          <h2 id="homework-title" className="pt-4 text-2xl font-bold">
            Домашка
          </h2>
          <Card title={lesson.homework.title}>
            {lesson.homework.steps.length > 0 && (
              <ol className="list-decimal space-y-2 pl-5 leading-relaxed marker:font-mono marker:text-ink-soft">
                {lesson.homework.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
            {lesson.homework.deliverable && (
              <p className="mt-4 rounded-2xl bg-lavender p-4 leading-relaxed">
                <span className="font-semibold">Что сдать: </span>
                {lesson.homework.deliverable}
              </p>
            )}
            <div className="mt-5">
              <StepToggle lessonId={lesson.id} step={LESSON_STEP_HOMEWORK} done={done.has(LESSON_STEP_HOMEWORK)} label="Домашка сделана" />
            </div>
          </Card>
        </section>

        {notes && (notes.timeline.length > 0 || notes.materials.length > 0) && (
          <details className="group rounded-3xl bg-ink/[0.03] ring-1 ring-ink/10">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
              Для ведущего: план и материалы
              <span className="text-sm text-violet group-open:hidden">Показать</span>
              <span className="hidden text-sm text-violet group-open:inline">Свернуть</span>
            </summary>
            <div className="space-y-5 px-5 pb-5 sm:px-6">
              {notes.timeline.length > 0 && (
                <ol className="space-y-3">
                  {notes.timeline.map((item, i) => (
                    <li key={i} className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
                      <p className="font-mono text-xs text-ink-soft">{item.minutes}′</p>
                      <p className="font-semibold">{item.block}</p>
                      {item.teacherNotes && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.teacherNotes}</p>}
                    </li>
                  ))}
                </ol>
              )}
              {notes.materials.length > 0 && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                  {notes.materials.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>

      <nav aria-label="Другие уроки" className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prev ? (
          <Link href={`/app/lessons/${prev.n}`} className="rounded-3xl bg-white p-5 ring-1 ring-ink/10 hover:ring-violet">
            <span className="inline-flex items-center gap-1 font-mono text-xs text-ink-soft">
              <ArrowLeft aria-hidden="true" className="size-3" /> Урок {prev.n}
            </span>
            <span className="mt-1 block font-semibold">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/app/lessons/${next.n}`} className="rounded-3xl bg-white p-5 text-right ring-1 ring-ink/10 hover:ring-violet">
            <span className="inline-flex items-center gap-1 font-mono text-xs text-ink-soft">
              Урок {next.n} <ArrowRight aria-hidden="true" className="size-3" />
            </span>
            <span className="mt-1 block font-semibold">{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label="Прогресс урока"
      className="h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-lavender"
    >
      <div className="h-full rounded-full bg-violet" style={{ width: `${pct}%` }} />
    </div>
  );
}

function LessonSkeleton() {
  return (
    <div>
      <Skeleton className="h-3 w-full max-w-xs" />
      <Skeleton className="mt-8 h-12 w-full" />
      <Skeleton className="mt-6 h-64" />
      <Skeleton className="mt-6 h-96" />
    </div>
  );
}
