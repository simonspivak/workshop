import "server-only";
import type { SessionUser } from "@/lib/server/dal/auth";
import { mediaKindOfPath } from "@/lib/server/media-refs";
import { getPriceList } from "@/lib/server/prices";
import { signMediaPaths } from "@/lib/server/storage";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { createClient } from "@/lib/server/supabase/server";
import type { Json } from "@/lib/server/supabase/types";
import type { JobAction, JobStatus } from "@/lib/platform/generation-types";
import type { HomeworkAttachmentView } from "@/lib/platform/homework-types";
import { ATTACHABLE_ACTIONS, attachmentDuration, attachmentIds, checkAttachmentRows, type AttachmentCheck } from "./attachment-rules";
import type { AttachmentForGrading } from "./rubric";

/*
  Результаты из галереи в домашке (docs/platform/spec.md «Домашки»). В сдаче хранятся только
  id задач (homework_submissions.attachments), файлы не копируются: показываем по подписанным
  ссылкам из jobs.storage_path. Права на саму сдачу проверяет вызывающий код (своя сдача,
  ведущий группы, админ); здесь задачи дополнительно сверяются с владельцем сдачи.
*/

const OPTIONS_LIMIT = 60;
const PROMPT_VIEW_CHARS = 300;

type JobForAttachment = {
  id: string;
  user_id: string;
  action: JobAction;
  model: string;
  status: JobStatus;
  prompt: string | null;
  params: Json;
  storage_path: string | null;
  hidden: boolean;
  deleted_at: string | null;
  created_at: string;
};

const COLUMNS = "id, user_id, action, model, status, prompt, params, storage_path, hidden, deleted_at, created_at";

/** Проверить выбор при сдаче: каждый id — свой готовый, не удалённый результат-медиа. */
export async function validateAttachments(userId: string, ids: readonly string[]): Promise<AttachmentCheck> {
  if (ids.length === 0) return { ok: true, ids: [] };
  // не uuid, повторы, больше 20 — отказ без запроса в базу
  const unique = attachmentIds(ids);
  if (unique.length !== ids.length) return { ok: false, error: "bad_attachments" };
  const { data, error } = await createAdminClient()
    .from("jobs")
    .select("id, user_id, action, status, hidden, deleted_at")
    .in("id", unique);
  if (error) throw new Error(`homework.validateAttachments failed (${error.code})`);
  return checkAttachmentRows(ids, data ?? [], userId);
}

async function modelLabels(): Promise<Map<string, string>> {
  try {
    const rows = await getPriceList();
    return new Map(rows.filter((row) => row.label).map((row) => [`${row.action}:${row.model}`, row.label as string]));
  } catch {
    return new Map();
  }
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || null;
}

async function toViews(jobs: JobForAttachment[], options: { revealHidden: boolean; sign: boolean }): Promise<Map<string, HomeworkAttachmentView>> {
  const labels = await modelLabels();
  const visible = (job: JobForAttachment) => !job.deleted_at && (!job.hidden || options.revealHidden);
  const paths = options.sign ? jobs.filter((job) => visible(job) && job.storage_path).map((job) => job.storage_path as string) : [];
  const signed = await signMediaPaths(paths);
  const result = new Map<string, HomeworkAttachmentView>();
  for (const job of jobs) {
    const path = job.storage_path;
    result.set(job.id, {
      jobId: job.id,
      deleted: job.deleted_at !== null,
      hidden: job.hidden && !options.revealHidden,
      action: job.action,
      kind: path ? mediaKindOfPath(path) : null,
      model: labels.get(`${job.action}:${job.model}`) ?? job.model,
      prompt: clip(job.prompt, PROMPT_VIEW_CHARS),
      durationSec: attachmentDuration(job.action, job.params),
      url: visible(job) && path ? (signed.get(path) ?? null) : null,
      createdAt: job.created_at,
    });
  }
  return result;
}

/**
 * Прикреплённые к сдаче результаты по порядку выбора. Задача, которой больше нет или которая
 * не принадлежит владельцу сдачи, показывается как «результат удалён».
 * revealHidden — ведущему видны и скрытые им результаты; sign — подписать ссылки на файлы.
 */
export async function loadAttachments(
  ownerId: string,
  value: unknown,
  options: { revealHidden?: boolean; sign?: boolean } = {},
): Promise<HomeworkAttachmentView[]> {
  const ids = attachmentIds(value);
  if (ids.length === 0) return [];
  const { data, error } = await createAdminClient().from("jobs").select(COLUMNS).in("id", ids).eq("user_id", ownerId).returns<JobForAttachment[]>();
  if (error) throw new Error(`homework.loadAttachments failed (${error.code})`);
  const views = await toViews(data ?? [], { revealHidden: options.revealHidden ?? false, sign: options.sign ?? true });
  return ids.map(
    (id) =>
      views.get(id) ?? {
        jobId: id,
        deleted: true,
        hidden: false,
        action: null,
        kind: null,
        model: null,
        prompt: null,
        durationSec: null,
        url: null,
        createdAt: null,
      },
  );
}

/** Метаданные для промпта проверки: модель видео не смотрит, видит тип, модель, длину и промпт. */
export function attachmentsForGrading(views: HomeworkAttachmentView[]): AttachmentForGrading[] {
  return views.map((view) => ({
    action: view.action,
    model: view.model,
    durationSec: view.durationSec,
    prompt: view.prompt,
    deleted: view.deleted,
  }));
}

/** Свои готовые результаты для выбора «Прикрепить из галереи» (новые первыми, через RLS). */
export async function listAttachOptions(user: SessionUser): Promise<HomeworkAttachmentView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .eq("status", "done")
    .eq("hidden", false)
    .is("deleted_at", null)
    .in("action", [...ATTACHABLE_ACTIONS])
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(OPTIONS_LIMIT)
    .returns<JobForAttachment[]>();
  if (error) throw new Error(`homework.listAttachOptions failed (${error.code})`);
  const rows = data ?? [];
  const views = await toViews(rows, { revealHidden: false, sign: true });
  return rows.flatMap((row) => {
    const view = views.get(row.id);
    return view && view.url && view.kind ? [view] : [];
  });
}
