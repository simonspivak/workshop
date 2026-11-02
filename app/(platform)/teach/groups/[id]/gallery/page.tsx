import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { toggleJobHidden } from "./actions";
import { GalleryKindFilter, GalleryPager, parseGalleryKind, parseGalleryPage } from "@/components/platform/GalleryFilters";
import { GalleryGrid } from "@/components/platform/GalleryGrid";
import { Container, Notice, PageTitle, Skeleton, buttonClass, inputClass, labelClass } from "@/components/platform/ui";
import { requireStaff } from "@/lib/server/dal/auth";
import { getGroup, isUuid, listStudents } from "@/lib/server/dal/teacher";
import { listGroupGalleryForTeacher } from "@/lib/server/gallery";

export const metadata: Metadata = { title: "Галерея группы" };

export default function GroupGalleryPage({ params, searchParams }: PageProps<"/teach/groups/[id]/gallery">) {
  return (
    <Container>
      <Suspense fallback={<GallerySkeleton />}>
        <GroupGallery params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function GroupGallery({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireStaff();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const group = await getGroup(user, id);
  if (!group) notFound();

  const kind = parseGalleryKind(sp.kind);
  const page = parseGalleryPage(sp.page);
  const studentId = typeof sp.student === "string" && isUuid(sp.student) ? sp.student : null;
  const [data, students] = await Promise.all([
    listGroupGalleryForTeacher(user, group.id, { kind, page, studentId }),
    listStudents(user, group.id),
  ]);
  const base = `/teach/groups/${group.id}/gallery`;
  const filterParams = { kind, student: studentId };

  return (
    <>
      <Link
        href={`/teach/groups/${group.id}`}
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Группа {group.code}
      </Link>
      <PageTitle eyebrow={`Группа ${group.code} · ${group.title}`} title="Галерея группы">
        Все результаты учеников. Неподходящий результат можно скрыть: он пропадёт из общей галереи, ученик увидит
        пометку, а файл нельзя будет подставить как референс. Каждое действие пишется в журнал.
      </PageTitle>

      <div className="mb-6 space-y-4">
        <GalleryKindFilter base={base} params={filterParams} kind={kind} />
        {students.length > 0 && (
          <form method="get" action={base} className="flex flex-wrap items-end gap-3">
            {kind && <input type="hidden" name="kind" value={kind} />}
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="student" className={labelClass}>
                Ученик
              </label>
              <select id="student" name="student" defaultValue={studentId ?? ""} className={`${inputClass} mt-2`}>
                <option value="">Все ученики</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nickname}
                    {s.login ? ` · ${s.login}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              Показать
            </button>
          </form>
        )}
        {group.shareGallery ? (
          <Notice>Общая галерея включена: ученики видят готовые нескрытые работы друг друга.</Notice>
        ) : (
          <Notice>Общая галерея выключена: каждый ученик видит только свои работы. Включается в настройках группы.</Notice>
        )}
      </div>

      <GalleryGrid items={data.items} mode="teacher" hideAction={toggleJobHidden} emptyText="Здесь пока пусто." />
      <GalleryPager base={base} params={filterParams} page={data.page} hasMore={data.hasMore} />
    </>
  );
}

function GallerySkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-64" />
      <div className="mt-8 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
