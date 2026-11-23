"use client";

import { RichText } from "@/components/platform/RichText";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Copy, ExternalLink, EyeOff, LoaderCircle, LogIn, RefreshCw, TriangleAlert } from "lucide-react";
import { DeleteJobButton, canDeleteJob } from "@/components/platform/DeleteJobButton";
import { loginAgainHref, useLiveJob, type LiveJob, type LivePollStop } from "@/components/platform/GenerateClient";
import { Badge, Stars, buttonClass } from "@/components/platform/ui";
import { UNCERTAIN_AFTER_MS } from "@/lib/platform/job-poll";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import {
  isActiveJobStatus,
  jobActionLabels,
  jobStatusLabels,
  type JobView,
  type MediaFile,
} from "@/lib/platform/generation-types";

/** Файл результата: картинка, видео или звук. Ссылки подписаны на час. */
export function MediaPreview({ file, alt }: { file: MediaFile; alt: string }) {
  if (file.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки Storage, оптимизатор не нужен
      <img src={file.url} alt={alt} loading="lazy" className="h-auto max-h-[28rem] w-full rounded-2xl bg-lavender object-contain" />
    );
  }
  if (file.kind === "video") {
    return (
      <video
        src={file.url}
        controls
        playsInline
        preload="metadata"
        className="max-h-[28rem] w-full rounded-2xl bg-ink"
        aria-label={alt}
      />
    );
  }
  return <audio src={file.url} controls preload="none" className="w-full" aria-label={alt} />;
}

export function JobMedia({ job, renderFileActions }: { job: JobView; renderFileActions?: (file: MediaFile) => ReactNode }) {
  if (job.hidden && job.media.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-lavender px-4 py-6 text-sm text-ink-soft">
        <EyeOff aria-hidden="true" className="size-4 shrink-0" /> Ведущий скрыл этот результат.
      </p>
    );
  }
  if (job.text) return <TextResult text={job.text} />;
  if (job.media.length === 0) return null;
  return (
    <div className="space-y-3">
      {job.media.map((file, i) => (
        <div key={file.path} className="space-y-2">
          {/* Suno присылает 2 трека: подписываем, чтобы было видно, что их два и какой где */}
          {job.action === "music" && job.media.length > 1 && <p className="font-mono text-xs text-ink-soft">Трек {i + 1}</p>}
          <MediaPreview file={file} alt={`${jobActionLabels[job.action]}${job.media.length > 1 ? `, файл ${i + 1}` : ""}`} />
          {renderFileActions?.(file)}
        </div>
      ))}
    </div>
  );
}

function TextResult({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl bg-lavender p-4">
      <RichText text={text} className="text-base leading-relaxed" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-ink/15 hover:bg-glow"
      >
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        {copied ? "Скопировано" : "Скопировать ответ"}
      </button>
    </div>
  );
}

/** live — состояние опроса из useLiveJob: если опрос остановился, вместо спиннера кнопка «Обновить». */
export function JobStatusLine({ job, live }: { job: JobView; live?: Pick<LiveJob, "stopped" | "refresh"> }) {
  const uncertain = useAgeOver(job.status === "queued" ? job.createdAt : null, UNCERTAIN_AFTER_MS);
  if (isActiveJobStatus(job.status) && live?.stopped === "signed_out") return <SignedOutLine />;
  if (isActiveJobStatus(job.status) && live?.stopped) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft" role="status">
        <span>{stoppedText[live.stopped]}</span>
        <button type="button" onClick={live.refresh} className={buttonClass("secondary", "sm")}>
          <RefreshCw aria-hidden="true" className="size-4" /> Обновить
        </button>
      </div>
    );
  }
  if (isActiveJobStatus(job.status)) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        {job.status === "storing" ? "Сохраняем в галерею…" : uncertain ? UNCERTAIN_TEXT : slowHint(job)}
      </p>
    );
  }
  if (job.status === "failed") {
    return (
      <p className="flex items-start gap-2 text-sm text-coral-deep" role="alert">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {platformErrorMessage(job.error ?? "generation_failed")}
      </p>
    );
  }
  return null;
}

// queued без ответа шлюза: задача, возможно, не создана; правило «queued без задачи дольше 90 с» вернёт звёзды
const UNCERTAIN_TEXT = "Сервис генерации пока не подтвердил задачу. Ждём до полутора минут; если ответа не будет, звёзды вернутся сами.";

/** Опрос получил 401: сессия закрыта (смена пароля ведущим, выход). Опрос стоит, задача на сервере идёт дальше. */
function SignedOutLine() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft" role="status">
      <span>{stoppedText.signed_out}</span>
      <Link href={loginAgainHref(pathname)} className={buttonClass("secondary", "sm")}>
        <LogIn aria-hidden="true" className="size-4" /> Войти заново
      </Link>
    </div>
  );
}

const stoppedText: Record<LivePollStop, string> = {
  signed_out: "Пароль изменён или сессия закончилась. Войдите заново — задача не пропадёт.",
  ceiling: "Генерация идёт дольше обычного. Нажмите «Обновить», чтобы проверить ещё раз.",
  session: "Сессия закончилась. Обновите страницу, чтобы узнать, готово ли.",
  gone: "Задача не найдена. Обновите страницу.",
};

/** true, когда с момента since прошло больше ms. На сервере и при первой отрисовке — false (без расхождения гидратации). */
function useAgeOver(since: string | null, ms: number): boolean {
  const [over, setOver] = useState<{ since: string; value: boolean } | null>(null);
  useEffect(() => {
    if (!since) return;
    const left = Date.parse(since) + ms - Date.now();
    const timer = setTimeout(() => setOver({ since, value: true }), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [since, ms]);
  return Boolean(since && over?.since === since && over.value);
}

function slowHint(job: JobView): string {
  if (job.action === "video" || job.action === "motion") return "Генерируется. Видео — 1–3 минуты, можно заниматься другим.";
  if (job.action === "lipsync") return "Генерируется. Говорящая голова — до 5 минут.";
  return "Генерируется…";
}

export function JobMeta({ job, author }: { job: JobView; author?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="violet">{jobActionLabels[job.action]}</Badge>
      {job.status !== "done" && <Badge tone={job.status === "failed" ? "warn" : "neutral"}>{jobStatusLabels[job.status]}</Badge>}
      {job.hidden && <Badge tone="warn">скрыто</Badge>}
      {job.stars > 0 && (
        <span className="font-mono text-xs text-ink-soft">
          <Stars value={job.stars} />
        </span>
      )}
      {author && <span className="truncate text-sm text-ink-soft">{author}</span>}
    </div>
  );
}

/**
 * Результат генерации в уроке: сам опрашивает сервер, пока задача не готова.
 * onDeleted — показать «Удалить» (свои результаты: готовые и неудачные) и убрать карточку после удаления.
 */
export function GenerateJobCard({
  job: initial,
  onSettled,
  onDeleted,
}: {
  job: JobView;
  onSettled?: (job: JobView) => void;
  onDeleted?: (jobId: string) => void;
}) {
  const live = useLiveJob(initial, onSettled);
  const job = live.job;
  return (
    <article className="space-y-3 rounded-3xl bg-white p-4 ring-1 ring-ink/10">
      <JobMeta job={job} />
      {job.prompt && job.action !== "text" && (
        <p className="line-clamp-2 text-sm text-ink-soft" title={job.prompt}>
          {job.prompt}
        </p>
      )}
      {job.prompt && job.action === "text" && (
        <details className="text-sm text-ink-soft">
          <summary className="cursor-pointer font-semibold">Запрос</summary>
          <p className="mt-1 break-words whitespace-pre-wrap">{job.prompt}</p>
        </details>
      )}
      <JobStatusLine job={job} live={live} />
      <JobMedia
        job={job}
        renderFileActions={(file) =>
          // звук: у плеера не во всех браузерах есть «Скачать» — ссылка на весь файл, как в «Галерее»
          file.kind === "audio" ? (
            <a href={file.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <ExternalLink aria-hidden="true" className="size-4" /> Открыть
            </a>
          ) : null
        }
      />
      {onDeleted && canDeleteJob(job) && (
        <div className="flex justify-end">
          <DeleteJobButton job={job} onDeleted={onDeleted} />
        </div>
      )}
    </article>
  );
}
