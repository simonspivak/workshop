"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteJobAction } from "@/app/(platform)/app/gallery/actions";
import { buttonClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import { isActiveJobStatus, type JobView } from "@/lib/platform/generation-types";

/** Можно ли удалить: только готовую или неудачную задачу (идущую — нет, её звёзды ещё в игре). */
export function canDeleteJob(job: Pick<JobView, "status">): boolean {
  return !isActiveJobStatus(job.status);
}

/**
 * «Удалить» у результата: подтверждение, Server Action, затем onDeleted — родитель убирает
 * карточку сразу, а сервер (refresh в действии) присылает список уже без неё.
 */
export function DeleteJobButton({ job, onDeleted }: { job: JobView; onDeleted: (jobId: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    const question =
      job.status === "failed"
        ? "Убрать эту неудачную задачу из списка?"
        : "Удалить этот результат? Файл пропадёт из галереи и студии, звёзды за него не вернутся.";
    if (!window.confirm(question)) return;
    setPending(true);
    setError(null);
    const result = await deleteJobAction(job.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDeleted(job.id);
  };

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={remove} disabled={pending} className={buttonClass("danger", "sm")}>
        <Trash2 aria-hidden="true" className="size-4" />
        {pending ? "Удаляем…" : "Удалить"}
      </button>
      {error && <span className="text-sm text-coral-deep">{platformErrorMessage(error)}</span>}
    </span>
  );
}
