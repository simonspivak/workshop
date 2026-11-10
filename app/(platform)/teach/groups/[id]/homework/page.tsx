import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, Container, PageTitle, Skeleton } from "@/components/platform/ui";
import { listLessons } from "@/lib/server/course";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup, listStudents } from "@/lib/server/dal/teacher";
import { listGroupHomework, type HomeworkCell } from "@/lib/server/homework/submissions";

export const metadata: Metadata = { title: "Домашки группы" };

export default function GroupHomeworkPage({ params }: PageProps<"/teach/groups/[id]/homework">) {
  return (
    <Container>
      <Suspense fallback={<HomeworkSkeleton />}>
        <GroupHomework params={params} />
      </Suspense>
    </Container>
  );
}

async function GroupHomework({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const group = await getGroup(user, id);
  if (!group) notFound();
  const [students, cells] = await Promise.all([listStudents(user, group.id), listGroupHomework(user, group.id)]);
  const lessons = listLessons();
  const byStudent = new Map<string, Map<string, HomeworkCell>>();
  for (const cell of cells) {
    const row = byStudent.get(cell.userId) ?? new Map<string, HomeworkCell>();
    if (!row.has(cell.lessonId)) row.set(cell.lessonId, cell);
    byStudent.set(cell.userId, row);
  }
  const submitted = cells.length;
  const waiting = cells.filter((cell) => cell.teacherScore === null && (cell.aiSkipped || cell.status === "failed")).length;

  return (
    <>
      <Link href={`/teach/groups/${group.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Группа {group.code}
      </Link>
      <PageTitle eyebrow={`Группа ${group.code} · ${group.title}`} title="Домашки">
        Сдано работ: {submitted}. Ждут вашей оценки (ИИ не проверил): {waiting}. Нажмите на клетку, чтобы открыть работу и поставить
        оценку.
      </PageTitle>

      {students.length === 0 ? (
        <p className="rounded-3xl bg-lavender p-5 text-ink-soft">Учеников пока нет.</p>
      ) : (
        <Card
          title="Ученики и уроки"
          description="В клетке — оценка ИИ из 10; «ИИ 7 → 9» — ведущий поставил свою. «Ведущий» — ИИ не читает такой формат (картинка, видео, звук)."
        >
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10">
                  <th scope="col" className={`${th} pl-5 sm:pl-6`}>
                    Ученик
                  </th>
                  {lessons.map((lesson) => (
                    <th key={lesson.id} scope="col" className={th} title={lesson.title}>
                      Урок {lesson.n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b border-ink/5 last:border-0">
                    <th scope="row" className={`${td} pl-5 text-left font-normal sm:pl-6`}>
                      <span className="block font-semibold">{student.nickname}</span>
                      {student.login && <span className="block font-mono text-xs text-ink-soft">{student.login}</span>}
                    </th>
                    {lessons.map((lesson) => {
                      const cell = byStudent.get(student.id)?.get(lesson.id) ?? null;
                      return (
                        <td key={lesson.id} className={td}>
                          {cell ? <CellChip cell={cell} href={`/teach/groups/${group.id}/homework/${cell.id}`} /> : <span className="text-ink-soft">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

const th = "px-3 py-2 text-left font-mono text-xs font-medium tracking-wide text-ink-soft uppercase";
const td = "px-3 py-2.5 align-top";

function cellText(cell: HomeworkCell): { text: string; tone: string } {
  if (cell.teacherScore !== null) {
    return {
      text: cell.aiScore !== null ? `ИИ ${cell.aiScore} → ${cell.teacherScore}` : `${cell.teacherScore}/10`,
      tone: "bg-sun text-ink",
    };
  }
  switch (cell.status) {
    case "graded":
      return { text: `ИИ ${cell.aiScore ?? "?"}/10`, tone: "bg-violet text-white" };
    case "grading":
      return { text: "проверяется", tone: "bg-lavender text-ink" };
    case "failed":
      return { text: "ошибка ИИ", tone: "bg-coral/15 text-coral-deep" };
    default:
      return cell.aiSkipped ? { text: "ведущий", tone: "bg-coral/15 text-coral-deep" } : { text: "сдано", tone: "bg-lavender text-ink" };
  }
}

function CellChip({ cell, href }: { cell: HomeworkCell; href: string }) {
  const { text, tone } = cellText(cell);
  return (
    <Link href={href} className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs font-medium whitespace-nowrap hover:ring-2 hover:ring-violet ${tone}`}>
      {text}
    </Link>
  );
}

function HomeworkSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="mt-8 h-80" />
    </div>
  );
}
