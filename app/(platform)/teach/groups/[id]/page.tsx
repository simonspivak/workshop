import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChartColumn, ClipboardCheck, Download, Images, Bot } from "lucide-react";
import { AutoRefresh } from "./AutoRefresh";
import { CreateStudents } from "./CreateStudents";
import { GroupGrantForm } from "./GroupGrantForm";
import { GroupSettingsForm, PauseControl } from "./GroupSettings";
import { StudentList } from "./StudentList";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup, getGroupStarStats, listStudents, lowBalanceThreshold } from "@/lib/server/dal/teacher";
import { groupKindLabels } from "@/lib/platform/messages";
import { budgetWarnings } from "@/lib/platform/teacher-cabinet";
import { Badge, Card, Container, Notice, PageTitle, Skeleton, buttonClass } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Группа",
};

// Создание пачки учеников — до 60 вызовов Auth API
export const maxDuration = 60;

export default function GroupPage({ params }: PageProps<"/teach/groups/[id]">) {
  return (
    <Container>
      <Link
        href="/teach"
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Все группы
      </Link>
      <Suspense fallback={<GroupSkeleton />}>
        <Group params={params} />
      </Suspense>
    </Container>
  );
}

async function Group({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const group = await getGroup(user, id);
  if (!group) notFound();
  const [students, stars, lowThreshold] = await Promise.all([
    listStudents(user, group.id),
    getGroupStarStats(user, group.id),
    lowBalanceThreshold(),
  ]);
  const activeStudents = students.filter((s) => !s.disabled).length;
  const disabledStudents = students.length - activeStudents;
  const warnings = budgetWarnings({
    budgetStars: group.budgetStars,
    plannedStudents: group.plannedStudents,
    starsPerStudent: group.starsPerStudent,
    activeStudents,
    handed: stars.handed,
  });

  const settings = {
    id: group.id,
    title: group.title,
    kind: group.kind,
    endsOn: group.endsOn,
    budgetStars: group.budgetStars,
    plannedStudents: group.plannedStudents,
    starsPerStudent: group.starsPerStudent,
    allowGoogleMinors: group.allowGoogleMinors,
    shareGallery: group.shareGallery,
    paused: group.paused,
  };

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageTitle eyebrow={`Группа ${group.code} · ${groupKindLabels[group.kind]}`} title={group.title}>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
            <span>
              Учеников: {group.studentCount}
              {disabledStudents > 0 && `, отключено: ${disabledStudents}`}
            </span>
            {group.endsOn && <span>Последний урок: {formatDay(group.endsOn)}</span>}
            {group.paused && <Badge tone="warn">пауза</Badge>}
            {group.allowGoogleMinors && <Badge>Google для младших</Badge>}
          </span>
        </PageTitle>
      </div>

      <nav aria-label="Разделы группы" className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:hidden">
        <GroupSectionLink
          href={`/teach/groups/${group.id}/report`}
          icon={<ChartColumn aria-hidden="true" className="size-6 text-violet" />}
          title="Прогресс, тесты и звёзды"
          text="Отметки по урокам, баллы тестов, траты учеников за сегодня и за всё время."
        />
        <GroupSectionLink
          href={`/teach/groups/${group.id}/gallery`}
          icon={<Images aria-hidden="true" className="size-6 text-violet" />}
          title="Галерея группы"
          text="Все результаты учеников. Неподходящее можно скрыть."
        />
        <GroupSectionLink
          href={`/teach/groups/${group.id}/homework`}
          icon={<ClipboardCheck aria-hidden="true" className="size-6 text-violet" />}
          title="Домашки"
          text="Сдачи по урокам, оценки ИИ и ваша оценка с комментарием."
        />
        <GroupSectionLink
          href={`/teach/groups/${group.id}/bots`}
          icon={<Bot aria-hidden="true" className="size-6 text-violet" />}
          title="Боты группы"
          text="Боты учеников, их инструменты, Telegram и число заявок."
        />
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] print:hidden">
        <Card title="Настройки группы">
          <GroupSettingsForm group={settings} />
        </Card>
        <div className="space-y-6 self-start">
          <Card title="Звёзды группы">
            <dl className="space-y-2 font-mono text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Бюджет на курс</dt>
                <dd>{group.budgetStars != null ? `${group.budgetStars.toLocaleString("ru-RU")} ★` : "не задан"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Роздано</dt>
                <dd>{stars.handed.toLocaleString("ru-RU")} ★</dd>
              </div>
              {stars.given !== stars.handed && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Бонусы за тесты</dt>
                  <dd>{(stars.given - stars.handed).toLocaleString("ru-RU")} ★</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Потрачено</dt>
                <dd>{stars.spent.toLocaleString("ru-RU")} ★</dd>
              </div>
            </dl>
            {warnings.length > 0 && (
              <Notice tone="warn" className="mt-3">
                {warnings.map((text) => (
                  <span key={text} className="block">
                    {text}
                  </span>
                ))}
              </Notice>
            )}
            <div className="mt-5 border-t border-ink/10 pt-4">
              <GroupGrantForm groupId={group.id} activeStudents={activeStudents} />
            </div>
          </Card>
          <Card title="Пауза">
            <PauseControl group={settings} />
          </Card>
        </div>
      </div>

      <CreateStudents groupId={group.id} groupCode={group.code} groupTitle={group.title} starsPerStudent={group.starsPerStudent} />

      <Card title={`Ученики · ${students.length}`} className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <AutoRefresh />
          <a href={`/teach/groups/${group.id}/report.csv`} download className={buttonClass("secondary", "sm")}>
            <Download aria-hidden="true" className="size-4" /> Отчёт CSV
          </a>
        </div>
        <StudentList
          lowThreshold={lowThreshold}
          canDelete={user.role === "admin"}
          students={students.map((s) => ({
            id: s.id,
            login: s.login,
            nickname: s.nickname,
            ageBand: s.ageBand,
            consent: s.consentAt !== null,
            consentAt: s.consentAt,
            consentMethod: s.consentMethod,
            consentBy: s.consentBy,
            disabled: s.disabled,
            balance: s.balance,
          }))}
        />
      </Card>
    </div>
  );
}

function GroupSectionLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="group flex items-start gap-4 rounded-3xl bg-lavender p-5 transition-colors hover:bg-glow">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-display font-semibold">{title}</span>
        <span className="mt-1 block text-ink-soft">{text}</span>
      </span>
      <ArrowRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-violet transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function GroupSkeleton() {
  return (
    <div className="pt-6">
      <Skeleton className="h-10 w-64" />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
}
