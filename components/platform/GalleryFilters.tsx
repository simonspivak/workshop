import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { MediaKind } from "@/lib/platform/generation-types";

/*
  Фильтры и страницы галереи — обычные ссылки с параметрами (?kind=…&page=…), без клиентского кода.
*/

export type GalleryParams = Record<string, string | null | undefined>;

const KINDS: { value: MediaKind | null; label: string }[] = [
  { value: null, label: "Всё" },
  { value: "image", label: "Картинки" },
  { value: "video", label: "Видео" },
  { value: "audio", label: "Звук" },
];

export function galleryHref(base: string, params: GalleryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export function parseGalleryKind(value: unknown): MediaKind | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}

export function parseGalleryPage(value: unknown): number {
  const n = typeof value === "string" && /^[0-9]{1,4}$/.test(value) ? Number(value) : 0;
  return Math.min(n, 1000);
}

function chip(active: boolean) {
  return `shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1 ${
    active ? "bg-violet text-white ring-violet" : "bg-white ring-ink/10 hover:bg-lavender"
  }`;
}

export function GalleryTabs({
  base,
  params,
  tabs,
  current,
}: {
  base: string;
  params: GalleryParams;
  tabs: { value: string | null; label: string }[];
  current: string | null;
}) {
  return (
    <nav aria-label="Чья галерея" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={galleryHref(base, { ...params, view: tab.value, page: null })}
          aria-current={tab.value === current ? "page" : undefined}
          className={chip(tab.value === current)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function GalleryKindFilter({ base, params, kind }: { base: string; params: GalleryParams; kind: MediaKind | null }) {
  return (
    <nav aria-label="Тип файлов" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {KINDS.map((k) => (
        <Link
          key={k.label}
          href={galleryHref(base, { ...params, kind: k.value, page: null })}
          aria-current={k.value === kind ? "page" : undefined}
          className={chip(k.value === kind)}
        >
          {k.label}
        </Link>
      ))}
    </nav>
  );
}

export function GalleryPager({
  base,
  params,
  page,
  hasMore,
}: {
  base: string;
  params: GalleryParams;
  page: number;
  hasMore: boolean;
}) {
  if (page === 0 && !hasMore) return null;
  return (
    <nav aria-label="Страницы галереи" className="mt-6 flex items-center justify-between gap-3">
      {page > 0 ? (
        <Link href={galleryHref(base, { ...params, page: page > 1 ? String(page - 1) : null })} className="inline-flex items-center gap-1 font-semibold text-violet hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" /> Новее
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs text-ink-soft">Страница {page + 1}</span>
      {hasMore ? (
        <Link href={galleryHref(base, { ...params, page: String(page + 1) })} className="inline-flex items-center gap-1 font-semibold text-violet hover:underline">
          Старше <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
