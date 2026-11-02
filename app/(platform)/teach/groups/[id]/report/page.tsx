import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, Container, PageTitle, Skeleton, Stars } from "@/components/platform/ui";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup } from "@/lib/server/dal/teacher";
import { getGroupReport, type GroupReport } from "@/lib/server/group-reports";

export const metadata: Metadata = { title: "Отчёт группы" };

export default function GroupReportPage({ params }: PageProps<"/teach/groups/[id]/report">) {
  return (
    <Container>
      <Suspense fallback={<ReportSkeleton />}>
        <Report params={params} />
      </Suspense>
    </Container>
  );
}

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const group = await getGroup(user, id);
  if (!group) notFound();
  const report = await getGroupReport(user, group.id);

  return (
    <>
      <Link href={`/teach/groups/${group.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Группа {group.code}
      </Link>
      <PageTitle eyebrow={`Группа ${group.code} · ${group.title}`} title="Прогресс, тесты и звёзды">
        Отметки учеников по урокам, засчитанные тесты и траты. День считается по Берлину, как дневной лимит группы.
      </PageTitle>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Потрачено сегодня" value={<Stars value={report.totals.spentToday} />} hint={`Лимит группы: ${group.dailyCap.toLocaleString("ru-RU")} ★`} />
        <Stat label="Потрачено за всё время" value={<Stars value={report.totals.spentTotal} />} hint="С учётом возвратов" />
        <Stat label="Бонусы за тесты" value={<Stars value={report.totals.quizBonus} />} hint="+20 ★ за 8 из 10" />
      </div>

      {report.students.length === 0 ? (
        <p className="rounded-3xl bg-lavender p-5 text-ink-soft">Учеников пока нет.</p>
      ) : (
        <div className="space-y-6">
          <ProgressTable report={report} />
          <SpendingTable report={report} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-ink/10">
      <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
    </div>
  );
}

const th = "px-3 py-2 text-left font-mono text-xs font-medium tracking-wide text-ink-soft uppercase";
const td = "px-3 py-2.5 align-top";

function ProgressTable({ report }: { report: GroupReport }) {
  return (
    <Card title="Прогресс по урокам и тесты" description="Сколько шагов урока отмечено (теория, задания, тест, домашка) и балл засчитанного теста.">
      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              <th scope="col" className={`${th} pl-5 sm:pl-6`}>
                Ученик
              </th>
              {report.lessons.map((lesson) => (
                <th key={lesson.id} scope="col" className={th} title={lesson.title}>
                  Урок {lesson.n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.students.map((s) => (
              <tr key={s.id} className="border-b border-ink/5 last:border-0">
                <th scope="row" className={`${td} pl-5 text-left font-normal sm:pl-6`}>
                  <span className="block font-semibold">{s.nickname}</span>
                  {s.login && <span className="block font-mono text-xs text-ink-soft">{s.login}</span>}
                </th>
                {report.lessons.map((lesson) => {
                  const steps = s.progress[lesson.id] ?? 0;
                  const quiz = s.quiz[lesson.id];
                  return (
                    <td key={lesson.id} className={td}>
                      <span className={`block font-mono ${steps === 0 ? "text-ink-soft" : ""}`}>
                        {steps}/{lesson.steps}
                      </span>
                      <span className="block font-mono text-xs text-ink-soft">
                        {quiz ? (
                          <>
                            тест {quiz.score}/{quiz.maxScore}
                            {quiz.bonus > 0 && <span className="text-violet"> +{quiz.bonus}★</span>}
                          </>
                        ) : (
                          "тест —"
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SpendingTable({ report }: { report: GroupReport }) {
  return (
    <Card title="Звёзды" description="Траты на генерации и ответы бота за вычетом возвратов за неудачные генерации.">
      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              <th scope="col" className={`${th} pl-5 sm:pl-6`}>
                Ученик
              </th>
              <th scope="col" className={th}>
                Баланс
              </th>
              <th scope="col" className={th}>
                Сегодня
              </th>
              <th scope="col" className={th}>
                Всего
              </th>
              <th scope="col" className={th}>
                Генераций
              </th>
              <th scope="col" className={th}>
                Возвратов
              </th>
              <th scope="col" className={th}>
                Ответов бота
              </th>
            </tr>
          </thead>
          <tbody>
            {report.students.map((s) => (
              <tr key={s.id} className="border-b border-ink/5 font-mono last:border-0">
                <th scope="row" className={`${td} pl-5 text-left font-sans font-semibold sm:pl-6`}>
                  {s.nickname}
                </th>
                <td className={td}>
                  <Stars value={s.balance} />
                </td>
                <td className={td}>
                  <Stars value={s.spent.today} />
                </td>
                <td className={td}>
                  <Stars value={s.spent.total} />
                </td>
                <td className={td}>{s.spent.generations}</td>
                <td className={td}>{s.spent.refunds}</td>
                <td className={td}>{s.spent.botReplies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ReportSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-72" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-80" />
    </div>
  );
}
