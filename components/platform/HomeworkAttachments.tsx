import { Music, Trash2 } from "lucide-react";
import { Badge } from "@/components/platform/ui";
import { jobActionLabels } from "@/lib/platform/generation-types";
import type { HomeworkAttachmentView } from "@/lib/platform/homework-types";

/*
  Результаты из галереи, прикреплённые к домашке: сетка с видео (плеер, грузится по нажатию),
  картинками и звуком, под каждым — тип, модель, длина и промпт. Удалённый учеником результат —
  плашка «результат удалён», скрытый ведущим (для ученика) — «скрыто ведущим».
  Без состояния: работает и в карточке ученика (клиент), и на странице ведущего (сервер).
*/

export function attachmentSummary(list: HomeworkAttachmentView[]): string {
  const alive = list.filter((a) => !a.deleted);
  const counts = new Map<string, number>();
  for (const a of alive) {
    const label = a.action ? jobActionLabels[a.action] : "Файл";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, n]) => `${label.toLowerCase()} — ${n}`);
  const deleted = list.length - alive.length;
  if (deleted) parts.push(`удалено — ${deleted}`);
  return parts.join(", ");
}

export function formatSeconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace(".", ",")} с`;
}

export function AttachmentMedia({ item, compact = false }: { item: HomeworkAttachmentView; compact?: boolean }) {
  const box = compact ? "h-24" : "aspect-video";
  if (item.deleted) {
    return (
      <div className={`flex ${box} items-center justify-center gap-2 rounded-xl bg-lavender text-sm text-ink-soft`}>
        <Trash2 aria-hidden="true" className="size-4" /> результат удалён
      </div>
    );
  }
  if (item.hidden) {
    return <div className={`flex ${box} items-center justify-center rounded-xl bg-lavender text-sm text-ink-soft`}>скрыто ведущим</div>;
  }
  if (!item.url) {
    return <div className={`placeholder-stripes ${box} rounded-xl`} aria-hidden="true" />;
  }
  if (item.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки Storage
      <img src={item.url} alt={item.prompt ?? "Картинка из галереи"} loading="lazy" className={`${box} w-full rounded-xl bg-lavender object-cover`} />
    );
  }
  if (item.kind === "video") {
    return compact ? (
      <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className={`${box} w-full rounded-xl bg-ink object-cover`} />
    ) : (
      <video src={item.url} controls playsInline preload="metadata" className={`${box} w-full rounded-xl bg-ink`} />
    );
  }
  return compact ? (
    <div className={`flex ${box} items-center justify-center rounded-xl bg-lavender`} aria-hidden="true">
      <Music className="size-6 text-violet/70" />
    </div>
  ) : (
    <div className="flex flex-col justify-center gap-2 rounded-xl bg-lavender p-3">
      <Music aria-hidden="true" className="size-5 text-violet/70" />
      <audio src={item.url} controls preload="none" className="w-full" />
    </div>
  );
}

export function AttachmentCaption({ item }: { item: HomeworkAttachmentView }) {
  if (item.deleted) return null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="violet">{item.action ? jobActionLabels[item.action] : "Файл"}</Badge>
        {item.durationSec !== null && <span className="font-mono text-xs text-ink-soft">{formatSeconds(item.durationSec)}</span>}
        {item.model && <span className="truncate font-mono text-xs text-ink-soft">{item.model}</span>}
      </div>
      {item.prompt && (
        <p className="line-clamp-3 text-sm leading-snug text-ink-soft" title={item.prompt}>
          {item.prompt}
        </p>
      )}
    </div>
  );
}

/** Сетка прикреплённых результатов для просмотра (ученик и ведущий). */
export function HomeworkAttachmentGrid({ items }: { items: HomeworkAttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">
        Из галереи: {items.filter((a) => !a.deleted).length} · {attachmentSummary(items)}
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.jobId} className="min-w-0 rounded-2xl bg-white p-2 ring-1 ring-ink/10">
            <AttachmentMedia item={item} />
            <AttachmentCaption item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
