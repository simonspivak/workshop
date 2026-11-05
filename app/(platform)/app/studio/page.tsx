import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/server/dal/auth";
import { Container, PageTitle } from "@/components/platform/ui";
import { StudioEditor, StudioSkeleton } from "@/components/platform/StudioEditor";

export const metadata: Metadata = { title: "Монтаж ролика" };

// Ссылка из урока: /app/studio?lesson=lesson-2&task=l2-t5-edit — задача монтажа запомнит урок и задание.
const LESSON_RE = /^[a-z0-9-]{1,40}$/;
const TASK_RE = /^[A-Za-z0-9_.-]{1,80}$/;

export default function StudioPage({ searchParams }: PageProps<"/app/studio">) {
  return (
    <Container>
      <PageTitle eyebrow="Автомонтаж" title="Монтаж ролика">
        Клипы по порядку, реплики своими голосами, музыка и субтитры. Склейка идёт прямо в браузере и стоит 0&nbsp;★ —
        перемонтировать можно сколько угодно.
      </PageTitle>
      <Suspense fallback={<StudioSkeleton />}>
        <Studio searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Studio({ searchParams }: { searchParams: PageProps<"/app/studio">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const lesson = typeof params.lesson === "string" && LESSON_RE.test(params.lesson) ? params.lesson : null;
  const task = typeof params.task === "string" && TASK_RE.test(params.task) ? params.task : null;
  return <StudioEditor nickname={user.nickname} lessonId={lesson} taskRef={task} />;
}
