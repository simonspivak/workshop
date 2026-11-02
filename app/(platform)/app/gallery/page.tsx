import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { GalleryKindFilter, GalleryPager, GalleryTabs, parseGalleryKind, parseGalleryPage } from "@/components/platform/GalleryFilters";
import { GalleryGrid } from "@/components/platform/GalleryGrid";
import { Container, Notice, PageTitle, Skeleton } from "@/components/platform/ui";
import { requireUser } from "@/lib/server/dal/auth";
import { listMyGallery, listSharedGroupGallery } from "@/lib/server/gallery";

export const metadata: Metadata = { title: "Галерея" };

const BASE = "/app/gallery";

export default function GalleryPage({ searchParams }: PageProps<"/app/gallery">) {
  return (
    <Container>
      <Link href="/app" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> В кабинет
      </Link>
      <Suspense fallback={<GallerySkeleton />}>
        <Gallery searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Gallery({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = parseGalleryKind(sp.kind);
  const page = parseGalleryPage(sp.page);
  const shared = Boolean(user.group?.shareGallery) && user.role === "student";
  const view = shared && sp.view === "group" ? "group" : null;

  const data = view === "group" ? await listSharedGroupGallery(user, { kind, page }) : await listMyGallery(user, { kind, page });
  const params = { kind, view };

  return (
    <>
      <PageTitle eyebrow={user.group ? `Группа ${user.group.code}` : "Кабинет"} title="Галерея">
        Картинки, видео, озвучки, музыка и монтажи. Любой готовый файл можно подставить в следующее задание: нажмите «Как
        референс» — он появится первым в форме генерации урока.
      </PageTitle>

      <div className="mb-6 space-y-3">
        {shared && (
          <GalleryTabs
            base={BASE}
            params={params}
            current={view}
            tabs={[
              { value: null, label: "Мои" },
              { value: "group", label: "Группа" },
            ]}
          />
        )}
        <GalleryKindFilter base={BASE} params={params} kind={kind} />
      </div>

      {view === "group" && (
        <Notice className="mb-6">Работы одногруппников: ведущий открыл общую галерею. Скрытые ведущим сюда не попадают.</Notice>
      )}

      <GalleryGrid
        items={data?.items ?? []}
        mode="student"
        emptyText={
          view === "group"
            ? "В галерее группы пока пусто."
            : "Пока пусто. Откройте урок и запустите первую генерацию — результат появится здесь."
        }
      />
      {data && <GalleryPager base={BASE} params={params} page={data.page} hasMore={data.hasMore} />}
    </>
  );
}

function GallerySkeleton() {
  return (
    <div className="pt-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-4 h-16 w-full max-w-2xl" />
      <div className="mt-8 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
