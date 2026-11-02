"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLiveJob } from "@/components/platform/GenerateClient";
import { Badge, Stars } from "@/components/platform/ui";
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
      <p className="text-base leading-relaxed break-words whitespace-pre-wrap">{text}</p>
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

export function JobStatusLine({ job }: { job: JobView }) {
  if (isActiveJobStatus(job.status)) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        {job.status === "storing" ? "Сохраняем в галерею…" : slowHint(job)}
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

/** Результат генерации в уроке: сам опрашивает сервер, пока задача не готова. */
export function GenerateJobCard({ job: initial, onSettled }: { job: JobView; onSettled?: (job: JobView) => void }) {
  const job = useLiveJob(initial, onSettled);
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
      <JobStatusLine job={job} />
      <JobMedia job={job} />
    </article>
  );
}
