"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, CircleDashed, ExternalLink, FileText, Link2, LoaderCircle, Paperclip, RotateCcw, XCircle } from "lucide-react";
import { Badge, Notice, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { platformErrorMessage } from "@/lib/platform/generation-messages";
import {
  HOMEWORK_ACCEPT,
  MAX_HOMEWORK_BYTES,
  MAX_HOMEWORK_LINK,
  MAX_HOMEWORK_NOTE,
  MAX_HOMEWORK_TEXT,
  formatBytes,
  homeworkErrorMessages,
  homeworkStatusLabels,
  type CriterionVerdict,
  type HomeworkAiFeedback,
  type HomeworkKind,
  type HomeworkView,
} from "@/lib/platform/homework-types";

/*
  Сдача домашки в уроке (docs/platform/spec.md «Домашки»): файл, текст или ссылка.
  Файл уходит прямо в Storage по подписанной ссылке (как монтаж): POST /api/homework →
  PUT файла → POST /api/homework/[id]/complete. Текст и ссылка — одним POST.
  Ответ сервера уже содержит оценку ИИ; если проверка не успела за ~45 с, статус «проверяется»
  и панель опрашивает GET /api/homework/[id] раз в 5 секунд.
*/

const POLL_MS = 5_000;
const POLL_LIMIT = 36; // 3 минуты
const PREVIEW_CHARS = 600;

type SaveBody =
  | { ok: true; homework: HomeworkView; upload: { url: string; contentType: string; apiKey: string | null; maxBytes: number } | null }
  | { ok: false; error: string; field?: string };
type StateBody = { ok: true; homework: HomeworkView | null } | { ok: false; error: string };

type Phase = { name: "idle" } | { name: "uploading"; ratio: number } | { name: "grading" };

function errorText(code: string | null | undefined, field?: string): string {
  const text = code && code in homeworkErrorMessages ? homeworkErrorMessages[code as keyof typeof homeworkErrorMessages] : platformErrorMessage(code);
  const where = field === "note" ? "в комментарии" : field === "text" ? "в тексте" : field === "fileName" ? "в имени файла" : "";
  return where ? `${text} (${where})` : text;
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return (await response.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

/** PUT в подписанную ссылку Storage с прогрессом (fetch не умеет прогресс загрузки). */
function uploadFile(url: string, file: File, contentType: string, apiKey: string | null, onProgress: (ratio: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    if (apiKey) xhr.setRequestHeader("apikey", apiKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send(file);
  });
}

export function HomeworkPanel({ lessonId, initial }: { lessonId: string; initial: HomeworkView | null }) {
  const [homework, setHomework] = useState<HomeworkView | null>(initial);
  const [editing, setEditing] = useState(initial === null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  // опрос, пока ИИ проверяет
  const polls = useRef(0);
  useEffect(() => {
    if (!homework || homework.status !== "grading") return;
    const id = homework.id;
    const timer = setInterval(async () => {
      if (++polls.current > POLL_LIMIT) {
        clearInterval(timer);
        return;
      }
      try {
        const response = await fetch(`/api/homework/${id}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as StateBody | null;
        if (body?.ok && body.homework) setHomework(body.homework);
      } catch {
        // сеть моргнула — следующий опрос
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [homework]);

  const finish = useCallback((next: HomeworkView) => {
    polls.current = 0;
    setHomework(next);
    setEditing(false);
    setPhase({ name: "idle" });
    setError(null);
  }, []);

  const submit = useCallback(
    async (input: { kind: HomeworkKind; file: File | null; text: string; link: string; note: string }) => {
      setError(null);
      const payload: Record<string, unknown> = { lessonId, kind: input.kind, note: input.note || undefined };
      if (input.kind === "file") {
        if (!input.file) return setError("Выберите файл.");
        if (input.file.size > MAX_HOMEWORK_BYTES) return setError(homeworkErrorMessages.file_too_large);
        payload.fileName = input.file.name;
        payload.sizeBytes = input.file.size;
        setPhase({ name: "uploading", ratio: 0 });
      } else {
        if (input.kind === "text") payload.text = input.text;
        else payload.linkUrl = input.link;
        setPhase({ name: "grading" });
      }

      const created = await postJson<SaveBody>("/api/homework", payload);
      if (!created || !created.ok) {
        setPhase({ name: "idle" });
        return setError(created && !created.ok ? errorText(created.error, created.field) : errorText("server_error"));
      }
      if (input.kind !== "file" || !created.upload) return finish(created.homework);

      const { upload, homework: pending } = created;
      const uploaded = await uploadFile(upload.url, input.file!, upload.contentType, upload.apiKey, (ratio) =>
        setPhase({ name: "uploading", ratio }),
      );
      if (!uploaded) {
        await postJson(`/api/homework/${pending.id}/complete`, { abort: true });
        setPhase({ name: "idle" });
        return setError(homeworkErrorMessages.upload_failed);
      }
      setPhase({ name: "grading" });
      const done = await postJson<StateBody>(`/api/homework/${pending.id}/complete`, {});
      if (!done || !done.ok || !done.homework) {
        setPhase({ name: "idle" });
        return setError(done && !done.ok ? errorText(done.error) : errorText("server_error"));
      }
      finish(done.homework);
    },
    [lessonId, finish],
  );

  if (editing || !homework) {
    return (
      <HomeworkForm
        phase={phase}
        error={error}
        onSubmit={submit}
        onCancel={homework ? () => setEditing(false) : null}
        resubmit={homework !== null}
      />
    );
  }
  return <HomeworkResult homework={homework} onResubmit={() => setEditing(true)} />;
}

// ---------- форма ----------

const KINDS: { kind: HomeworkKind; label: string; icon: typeof Paperclip }[] = [
  { kind: "file", label: "Файл", icon: Paperclip },
  { kind: "text", label: "Текст", icon: FileText },
  { kind: "link", label: "Ссылка", icon: Link2 },
];

function HomeworkForm({
  phase,
  error,
  onSubmit,
  onCancel,
  resubmit,
}: {
  phase: Phase;
  error: string | null;
  onSubmit: (input: { kind: HomeworkKind; file: File | null; text: string; link: string; note: string }) => Promise<void>;
  onCancel: (() => void) | null;
  resubmit: boolean;
}) {
  const [kind, setKind] = useState<HomeworkKind>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase.name !== "idle";

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  return (
    <form
      className="rounded-2xl bg-paper p-4 ring-1 ring-ink/10 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void onSubmit({ kind, file, text, link, note });
      }}
    >
      <h3 className="text-lg font-semibold">{resubmit ? "Сдать заново" : "Сдать домашку"}</h3>
      <p className={hintClass}>
        {resubmit
          ? "Новая сдача заменит прошлую: ведущий увидит обе, оценка ИИ будет по новой."
          : "ИИ проверит работу сразу и поставит оценку от 1 до 10. Ведущий увидит сдачу и может поставить свою оценку."}
      </p>

      <div role="radiogroup" aria-label="Что сдаёшь" className="mt-4 flex flex-wrap gap-2">
        {KINDS.map(({ kind: k, label, icon: Icon }) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            disabled={busy}
            onClick={() => setKind(k)}
            className={`${buttonClass(kind === k ? "primary" : "secondary", "sm")}`}
          >
            <Icon aria-hidden="true" className="size-4" /> {label}
          </button>
        ))}
      </div>

      {kind === "file" && (
        <div className="mt-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
              dragging ? "border-violet bg-lavender" : "border-ink/15 bg-white"
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              accept={HOMEWORK_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="break-words">
                <span className="font-semibold">{file.name}</span>
                <span className="text-ink-soft"> · {formatBytes(file.size)}</span>
              </p>
            ) : (
              <p className="text-ink-soft">Перетащи файл сюда или выбери на устройстве</p>
            )}
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={`${buttonClass("secondary", "sm")} mt-3`}>
              {file ? "Другой файл" : "Выбрать файл"}
            </button>
          </div>
          <p className={hintClass}>PDF, PPTX, DOCX, TXT, MD — проверит ИИ. PNG, JPG, WEBP, MP4, MP3, M4A, WAV — оценит ведущий. До 50 МБ.</p>
        </div>
      )}

      {kind === "text" && (
        <div className="mt-4">
          <label htmlFor="homework-text" className={labelClass}>
            Текст работы
          </label>
          <textarea
            id="homework-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_HOMEWORK_TEXT}
            rows={8}
            disabled={busy}
            className={`${inputClass} mt-1 min-h-40 resize-y font-mono text-sm`}
            placeholder="Вставь переписку с ИИ, объяснение или тексты слайдов"
          />
          <p className={hintClass}>
            {text.length.toLocaleString("ru-RU")} / {MAX_HOMEWORK_TEXT.toLocaleString("ru-RU")}
          </p>
        </div>
      )}

      {kind === "link" && (
        <div className="mt-4">
          <label htmlFor="homework-link" className={labelClass}>
            Ссылка
          </label>
          <input
            id="homework-link"
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            maxLength={MAX_HOMEWORK_LINK}
            disabled={busy}
            className={`${inputClass} mt-1`}
            placeholder="https://…"
          />
          <p className={hintClass}>Google Slides, Gemini Canvas, страница бота, Telegram. ИИ ссылку не открывает: оценит по адресу и комментарию, остальное — ведущий.</p>
        </div>
      )}

      {kind !== "text" && (
        <div className="mt-4">
          <label htmlFor="homework-note" className={labelClass}>
            Комментарий <span className="font-normal text-ink-soft">(необязательно)</span>
          </label>
          <textarea
            id="homework-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={MAX_HOMEWORK_NOTE}
            rows={3}
            disabled={busy}
            className={`${inputClass} mt-1 min-h-20 resize-y`}
            placeholder="Что менялось от промпта к промпту и почему — ИИ учтёт это при проверке"
          />
        </div>
      )}

      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={buttonClass("sun")}>
          {phase.name === "uploading" ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Загружаем… {Math.round(phase.ratio * 100)}%
            </>
          ) : phase.name === "grading" ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> ИИ проверяет…
            </>
          ) : (
            "Сдать домашку"
          )}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel} className={buttonClass("secondary")}>
            Отмена
          </button>
        )}
        {phase.name === "grading" && <span className="text-sm text-ink-soft">Обычно до минуты.</span>}
      </div>
    </form>
  );
}

// ---------- результат ----------

const VERDICT_STYLE: Record<CriterionVerdict, { icon: typeof CheckCircle2; className: string }> = {
  да: { icon: CheckCircle2, className: "text-violet" },
  частично: { icon: CircleDashed, className: "text-ink" },
  нет: { icon: XCircle, className: "text-coral-deep" },
};

function statusTone(status: HomeworkView["status"]): "neutral" | "violet" | "sun" | "warn" {
  if (status === "graded") return "violet";
  if (status === "grading") return "sun";
  if (status === "failed") return "warn";
  return "neutral";
}

export function HomeworkResult({ homework, onResubmit }: { homework: HomeworkView; onResubmit: (() => void) | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = homework.text ?? "";
  const long = text.length > PREVIEW_CHARS;

  return (
    <div className="rounded-2xl bg-paper p-4 ring-1 ring-ink/10 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">Твоя домашка</h3>
        <Badge tone={statusTone(homework.status)}>{homeworkStatusLabels[homework.status]}</Badge>
        <span className="font-mono text-xs text-ink-soft">{formatDate(homework.createdAt)}</span>
      </div>

      <div className="mt-3 space-y-2">
        {homework.kind === "file" && (
          <p className="flex flex-wrap items-center gap-2 break-words">
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />
            {homework.fileUrl ? (
              <a href={homework.fileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet underline-offset-4 hover:underline">
                {homework.fileName}
                <span className="sr-only"> (откроется в новой вкладке)</span>
              </a>
            ) : (
              <span className="font-semibold">{homework.fileName}</span>
            )}
            {homework.sizeBytes !== null && <span className="text-sm text-ink-soft">{formatBytes(homework.sizeBytes)}</span>}
          </p>
        )}
        {homework.kind === "link" && homework.linkUrl && (
          <p className="flex items-start gap-2 break-all">
            <Link2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-soft" />
            <a href={homework.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet underline-offset-4 hover:underline">
              {homework.linkUrl}
              <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          </p>
        )}
        {homework.kind === "text" && (
          <div>
            <pre className="rounded-2xl bg-white p-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap ring-1 ring-ink/10">
              {expanded || !long ? text : `${text.slice(0, PREVIEW_CHARS).trimEnd()}…`}
            </pre>
            {long && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-sm font-semibold text-violet hover:underline">
                {expanded ? "Свернуть" : "Показать всё"}
              </button>
            )}
          </div>
        )}
        {homework.note && <p className="text-sm leading-relaxed whitespace-pre-line text-ink-soft">{homework.note}</p>}
      </div>

      {homework.status === "grading" && (
        <Notice className="mt-4">
          <span className="inline-flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> ИИ проверяет работу. Обычно до минуты — страница обновится сама.
          </span>
        </Notice>
      )}
      {homework.aiNote && (
        <Notice className="mt-4" tone={homework.status === "failed" ? "warn" : "info"}>
          {homework.aiNote}
        </Notice>
      )}

      {homework.ai && <AiGrade score={homework.ai.score} feedback={homework.ai.feedback} />}

      {homework.teacher && (
        <div className="mt-4 rounded-2xl bg-sun/40 p-4">
          <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Оценка ведущего</p>
          <p className="mt-1 font-display text-2xl font-bold">{homework.teacher.score}/10</p>
          {homework.teacher.comment && <p className="mt-2 leading-relaxed whitespace-pre-line">{homework.teacher.comment}</p>}
        </div>
      )}

      {onResubmit && homework.status !== "grading" && (
        <div className="mt-5">
          <button type="button" onClick={onResubmit} className={buttonClass("secondary", "sm")}>
            <RotateCcw aria-hidden="true" className="size-4" /> Сдать заново
          </button>
        </div>
      )}
    </div>
  );
}

export function AiGrade({ score, feedback }: { score: number; feedback: HomeworkAiFeedback }) {
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-ink/10 sm:p-5">
      <div className="flex items-center gap-4">
        <p className="font-display text-4xl font-bold">
          {score}
          <span className="text-xl text-ink-soft">/10</span>
        </p>
        <p className="text-sm text-ink-soft">Оценка ИИ. Ведущий может её изменить.</p>
      </div>
      {feedback.criteria.length > 0 && (
        <ul className="mt-4 space-y-2">
          {feedback.criteria.map((criterion, i) => {
            const style = VERDICT_STYLE[criterion.verdict];
            const Icon = style.icon;
            return (
              <li key={i} className="flex gap-2">
                <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${style.className}`} />
                <span className="min-w-0">
                  <span className="font-semibold">{criterion.name}</span>
                  <span className="text-ink-soft"> — {criterion.verdict}</span>
                  {criterion.note && <span className="block text-sm leading-relaxed text-ink-soft">{criterion.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {feedback.summary && <p className="mt-4 leading-relaxed">{feedback.summary}</p>}
      {feedback.tips.length > 0 && (
        <div className="mt-4">
          <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Что улучшить</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 leading-relaxed">
            {feedback.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
