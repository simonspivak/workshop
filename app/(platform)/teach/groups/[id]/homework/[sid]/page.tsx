import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink, Link2, Paperclip } from "lucide-react";
import { TeacherGradeForm } from "../TeacherGradeForm";
import { AiGrade } from "@/components/platform/HomeworkPanel";
import { Badge, Card, Container, Notice, PageTitle, Skeleton } from "@/components/platform/ui";
import { getLessonById } from "@/lib/server/course";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup, isUuid } from "@/lib/server/dal/teacher";
import { getHomeworkForTeacher } from "@/lib/server/homework/submissions";
import { formatBytes, homeworkKindLabels, homeworkStatusLabels } from "@/lib/platform/homework-types";

export const metadata: Metadata = { title: "Домашка ученика" };

export default function TeacherHomeworkPage({ params }: PageProps<"/teach/groups/[id]/homework/[sid]">) {
  return (
    <Container>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </Container>
  );
}

async function Detail({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const user = await requireStaff();
  const { id, sid } = await params;
  const group = await getGroup(user, id);
  if (!group || !isUuid(sid)) notFound();
  const item = await getHomeworkForTeacher(user, sid);
  if (!item || (item.groupId !== group.id && user.role !== "admin")) notFound();
  const { homework, student } = item;
  const lesson = getLessonById(homework.lessonId);

  return (
    <>
      <Link
        href={`/teach/groups/${group.id}/homework`}
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Домашки группы {group.code}
      </Link>
      <PageTitle eyebrow={`${student.nickname}${student.login ? ` · ${student.login}` : ""}`} title={lesson ? `Урок ${lesson.n}: ${lesson.homework.title}` : "Домашка"}>
        <span className="flex flex-wrap items-center gap-2 text-base">
          <Badge>{homeworkKindLabels[homework.kind]}</Badge>
          <Badge tone={homework.status === "graded" ? "violet" : "neutral"}>{homeworkStatusLabels[homework.status]}</Badge>
          <span className="font-mono text-sm">{formatDateTime(homework.createdAt)}</span>
          {item.superseded && <Badge tone="warn">заменена новой сдачей</Badge>}
        </span>
      </PageTitle>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          <Card title="Работа">
            {lesson?.homework.deliverable && (
              <p className="mb-4 rounded-2xl bg-lavender p-4 text-sm leading-relaxed">
                <span className="font-semibold">Что сдать: </span>
                {lesson.homework.deliverable}
              </p>
            )}
            {homework.kind === "file" && (
              <p className="flex flex-wrap items-center gap-2 break-words">
                <Paperclip aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />
                {homework.fileUrl ? (
                  <a href={homework.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet underline-offset-4 hover:underline">
                    {homework.fileName}
                    <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                    <span className="sr-only"> (откроется в новой вкладке)</span>
                  </a>
                ) : (
                  <span className="font-semibold">{homework.fileName}</span>
                )}
                {homework.sizeBytes !== null && <span className="text-sm text-ink-soft">{formatBytes(homework.sizeBytes)}</span>}
              </p>
            )}
            {homework.kind === "link" && homework.linkUrl && (
              <p className="flex items-start gap-2 break-all">
                <Link2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-soft" />
                <a href={homework.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet underline-offset-4 hover:underline">
                  {homework.linkUrl}
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                  <span className="sr-only"> (откроется в новой вкладке)</span>
                </a>
              </p>
            )}
            {homework.text && (
              <pre className="rounded-2xl bg-paper p-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap ring-1 ring-ink/10">{homework.text}</pre>
            )}
            {homework.note && (
              <div className="mt-4">
                <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Комментарий ученика</p>
                <p className="mt-1 leading-relaxed whitespace-pre-line">{homework.note}</p>
              </div>
            )}
            {homework.aiNote && <Notice className="mt-4">{homework.aiNote}</Notice>}
            {homework.status === "grading" && <Notice className="mt-4">ИИ ещё проверяет работу. Обновите страницу через минуту.</Notice>}
            {homework.ai && (
              <div className="mt-2">
                <AiGrade score={homework.ai.score} feedback={homework.ai.feedback} />
                {homework.ai.model && <p className="mt-2 font-mono text-xs text-ink-soft">Модель: {homework.ai.model}</p>}
              </div>
            )}
          </Card>
        </div>
        <Card title="Оценка ведущего" description="Перекрывает оценку ИИ в таблице; ученик видит обе." className="self-start">
          <TeacherGradeForm submissionId={homework.id} initial={homework.teacher ? { score: homework.teacher.score, comment: homework.teacher.comment } : null} />
        </Card>
      </div>
    </>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function DetailSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-72" />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Skeleton className="h-96" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
