import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { CreateStudents } from "./CreateStudents";
import { GroupSettingsForm, PauseControl } from "./GroupSettings";
import { StudentList } from "./StudentList";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup, listStudents } from "@/lib/server/dal/teacher";
import { groupKindLabels } from "@/lib/platform/messages";
import { Badge, Card, Container, PageTitle, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Группа",
};

// Создание пачки учеников — до 40 вызовов Auth API
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
  const students = await listStudents(user, group.id);

  const settings = {
    id: group.id,
    title: group.title,
    kind: group.kind,
    endsOn: group.endsOn,
    dailyCap: group.dailyCap,
    allowGoogleMinors: group.allowGoogleMinors,
    shareGallery: group.shareGallery,
    paused: group.paused,
  };

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageTitle eyebrow={`Группа ${group.code} · ${groupKindLabels[group.kind]}`} title={group.title}>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
            <span>Учеников: {group.studentCount}</span>
            {group.endsOn && <span>Последний урок: {formatDay(group.endsOn)}</span>}
            {group.paused && <Badge tone="warn">пауза</Badge>}
            {group.allowGoogleMinors && <Badge>Google для младших</Badge>}
          </span>
        </PageTitle>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] print:hidden">
        <Card title="Настройки группы">
          <GroupSettingsForm group={settings} />
        </Card>
        <Card title="Пауза" className="self-start">
          <PauseControl group={settings} />
        </Card>
      </div>

      <CreateStudents groupId={group.id} groupCode={group.code} />

      <Card title={`Ученики · ${students.length}`} className="print:hidden">
        <StudentList
          students={students.map((s) => ({
            id: s.id,
            login: s.login,
            nickname: s.nickname,
            ageBand: s.ageBand,
            consent: s.consentAt !== null,
            disabled: s.disabled,
            balance: s.balance,
          }))}
        />
      </Card>
    </div>
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
