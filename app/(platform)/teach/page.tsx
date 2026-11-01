import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { CreateGroupForm } from "./CreateGroupForm";
import { requireStaff } from "@/lib/server/dal/auth";
import { listGroups } from "@/lib/server/dal/teacher";
import { groupKindLabels } from "@/lib/platform/messages";
import { Badge, Card, Container, PageTitle, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Группы",
};

export default function TeachPage() {
  return (
    <Container>
      <Suspense fallback={<GroupsSkeleton />}>
        <Groups />
      </Suspense>
    </Container>
  );
}

async function Groups() {
  const user = await requireStaff();
  const groups = await listGroups(user);

  return (
    <>
      <PageTitle eyebrow={user.role === "admin" ? "Админ · все группы" : "Кабинет ведущего"} title="Группы">
        Создайте группу, затем добавьте учеников пачкой: логины и пароли покажем один раз для печати карточек.
      </PageTitle>

      {groups.length === 0 ? (
        <p className="mb-8 rounded-3xl bg-lavender p-5 text-ink-soft">Групп пока нет.</p>
      ) : (
        <ul className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/teach/groups/${group.id}`}
                className="group flex h-full flex-col rounded-3xl bg-white p-5 ring-1 ring-ink/10 transition-colors hover:ring-violet"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-violet">{group.code}</span>
                  <Badge>{groupKindLabels[group.kind]}</Badge>
                  {group.paused && <Badge tone="warn">пауза</Badge>}
                </span>
                <span className="mt-2 font-display text-lg leading-snug font-semibold">{group.title}</span>
                <span className="mt-1 text-sm text-ink-soft">
                  Учеников: {group.studentCount}
                  {group.endsOn && <> · до {formatDay(group.endsOn)}</>}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-violet">
                  Открыть <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card title="Новая группа">
        <CreateGroupForm />
      </Card>
    </>
  );
}

function GroupsSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-40" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(value));
}
