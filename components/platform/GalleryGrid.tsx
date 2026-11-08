"use client";

import { useActionState, useState } from "react";
import { Check, Eye, EyeOff, ExternalLink, Pin } from "lucide-react";
import { DeleteJobButton, canDeleteJob } from "@/components/platform/DeleteJobButton";
import { useLiveJob, useReferenceTray } from "@/components/platform/GenerateClient";
import { JobMedia, JobMeta, JobStatusLine } from "@/components/platform/GenerateJobCard";
import { buttonClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import { jobActionLabels, type GalleryItem, type JobAction, type MediaFile } from "@/lib/platform/generation-types";

export type HideResult = { ok: true } | { ok: false; error: string };
export type HideAction = (prev: HideResult | null, formData: FormData) => Promise<HideResult>;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

/**
 * Сетка галереи. Незавершённые задачи сами опрашивают /api/jobs/[id] раз в 5 секунд.
 * Ученик: «Как референс» кладёт файл в корзину референсов для форм генерации в уроках;
 * свои результаты можно удалить (мягко, без возврата звёзд). Ведущий: скрыть / показать
 * результат (hideAction — Server Action с аудитом) и удалить результат ученика.
 * Удалённая карточка пропадает сразу; сервер (refresh в действии) пришлёт список уже без неё.
 */
export function GalleryGrid({
  items,
  mode,
  hideAction,
  emptyText,
}: {
  items: GalleryItem[];
  mode: "student" | "teacher";
  hideAction?: HideAction;
  emptyText: string;
}) {
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = removed.length ? items.filter((item) => !removed.includes(item.id)) : items;
  if (visible.length === 0) return <p className="rounded-3xl bg-lavender p-5 text-ink-soft">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {visible.map((item) => (
        <li key={item.id}>
          <GalleryCard item={item} mode={mode} hideAction={hideAction} onDeleted={(id) => setRemoved((list) => [...list, id])} />
        </li>
      ))}
    </ul>
  );
}

function GalleryCard({
  item,
  mode,
  hideAction,
  onDeleted,
}: {
  item: GalleryItem;
  mode: "student" | "teacher";
  hideAction?: HideAction;
  onDeleted: (jobId: string) => void;
}) {
  const job = useLiveJob(item);
  // своё — ученик и ведущий; чужое в группе — только ведущий (сервер проверяет группу)
  const deletable = canDeleteJob(job) && (item.mine || mode === "teacher");
  return (
    <article className="flex h-full flex-col gap-3 rounded-3xl bg-white p-4 ring-1 ring-ink/10">
      <JobMeta job={job} author={item.author} />
      <JobStatusLine job={job} />
      <JobMedia
        job={job}
        renderFileActions={(file) => (
          <div className="flex flex-wrap gap-2">
            {mode === "student" && (
              <ReferenceButton file={file} action={job.action} label={`${jobActionLabels[job.action]} · ${dateFormat.format(new Date(job.createdAt))}`} />
            )}
            <a href={file.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <ExternalLink aria-hidden="true" className="size-4" /> Открыть
            </a>
          </div>
        )}
      />
      {job.prompt && (
        <p className="line-clamp-3 text-sm leading-relaxed text-ink-soft" title={job.prompt}>
          {job.prompt}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <time dateTime={job.createdAt} className="font-mono text-xs text-ink-soft">
          {dateFormat.format(new Date(job.createdAt))}
        </time>
        <div className="flex flex-wrap items-center gap-2">
          {mode === "teacher" && hideAction && job.status === "done" && <HideToggle jobId={job.id} hidden={job.hidden} action={hideAction} />}
          {deletable && <DeleteJobButton job={job} onDeleted={onDeleted} />}
        </div>
      </div>
    </article>
  );
}

function ReferenceButton({ file, action, label }: { file: MediaFile; action: JobAction; label: string }) {
  const tray = useReferenceTray();
  const added = tray.has(file.path);
  return (
    <button
      type="button"
      onClick={() => (added ? tray.remove(file.path) : tray.add({ path: file.path, kind: file.kind, label, action }))}
      aria-pressed={added}
      className={buttonClass(added ? "primary" : "secondary", "sm")}
      title={added ? "Убрать из референсов" : "Подставится первым в формах генерации в уроках"}
    >
      {added ? <Check aria-hidden="true" className="size-4" /> : <Pin aria-hidden="true" className="size-4" />}
      {added ? "В референсах" : "Как референс"}
    </button>
  );
}

function HideToggle({ jobId, hidden, action }: { jobId: string; hidden: boolean; action: HideAction }) {
  const [state, dispatch, pending] = useActionState<HideResult | null, FormData>(action, null);
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="hidden" value={hidden ? "0" : "1"} />
      <button type="submit" disabled={pending} className={buttonClass(hidden ? "secondary" : "danger", "sm")}>
        {hidden ? <Eye aria-hidden="true" className="size-4" /> : <EyeOff aria-hidden="true" className="size-4" />}
        {pending ? "Секунду…" : hidden ? "Показать" : "Скрыть"}
      </button>
      {state && !state.ok && <span className="text-sm text-coral-deep">{platformErrorMessage(state.error)}</span>}
    </form>
  );
}
