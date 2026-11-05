"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isActiveJobStatus, type JobAction, type JobView, type MediaKind } from "@/lib/platform/generation-types";

/*
  Браузерная часть генераций: запрос в /api/generate, опрос /api/jobs/[id] раз в 5 секунд
  и «корзина референсов» — файлы, отмеченные в галерее кнопкой «Как референс».
  Корзина — удобство одного браузера (localStorage), сервер всё равно проверяет каждый путь.
*/

export const POLL_MS = 5_000;

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export type GenerateResponse =
  | { ok: true; jobId: string; job: JobView | null; balance: number | null }
  | { ok: false; error: string; jobId?: string; network?: boolean };

export async function postGenerate(body: Record<string, unknown>): Promise<GenerateResponse> {
  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "server_error", network: true };
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data || typeof data.jobId !== "string") {
    return {
      ok: false,
      error: typeof data?.error === "string" ? data.error : "server_error",
      jobId: typeof data?.jobId === "string" ? data.jobId : undefined,
    };
  }
  return {
    ok: true,
    jobId: data.jobId,
    job: (data.job as JobView | undefined) ?? null,
    balance: typeof data.balance === "number" ? data.balance : null,
  };
}

export async function fetchJob(id: string): Promise<JobView | null> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { job?: JobView };
    return data.job ?? null;
  } catch {
    return null;
  }
}

/**
 * Живое состояние задачи: пока она не готова, спрашиваем сервер раз в 5 секунд
 * (во вкладке в фоне — пропускаем тики). onSettled — когда задача стала done или failed.
 */
export function useLiveJob(initial: JobView, onSettled?: (job: JobView) => void): JobView {
  const [job, setJob] = useState(initial);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const active = isActiveJobStatus(job.status);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const next = await fetchJob(job.id);
        if (cancelled) return;
        if (next) {
          setJob(next);
          if (!isActiveJobStatus(next.status)) {
            settledRef.current?.(next);
            return;
          }
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, initial.status === "queued" ? 1_500 : POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, job.id, initial.status]);

  return job;
}

// ---------- корзина референсов ----------

/** action — задача, из которой файл: по нему форма «говорящей головы» отличает озвучку от музыки. */
export type TrayItem = { path: string; kind: MediaKind; label: string; url?: string; action?: JobAction };

const TRAY_KEY = "iistart:reference-tray";
const TRAY_MAX = 12;
const listeners = new Set<() => void>();
let trayCache: { raw: string | null; items: TrayItem[] } = { raw: null, items: [] };

function readTrayRaw(): string | null {
  try {
    return window.localStorage.getItem(TRAY_KEY);
  } catch {
    return null;
  }
}

function getTray(): TrayItem[] {
  const raw = readTrayRaw();
  if (raw === trayCache.raw) return trayCache.items;
  let items: TrayItem[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      items = parsed
        .filter(
          (item): item is TrayItem =>
            Boolean(item) &&
            typeof item.path === "string" &&
            typeof item.label === "string" &&
            typeof item.kind === "string" &&
            (item.action === undefined || typeof item.action === "string"),
        )
        .slice(0, TRAY_MAX);
    }
  } catch {
    items = [];
  }
  trayCache = { raw, items };
  return items;
}

function writeTray(items: TrayItem[]) {
  try {
    window.localStorage.setItem(
      TRAY_KEY,
      JSON.stringify(items.slice(0, TRAY_MAX).map(({ path, kind, label, action }) => ({ path, kind, label, action }))),
    );
  } catch {
    // приватный режим или запрет хранилища: корзина просто не запомнится
  }
  for (const listener of listeners) listener();
}

function subscribeTray(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === TRAY_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: TrayItem[] = [];

export function useReferenceTray(): {
  items: TrayItem[];
  add: (item: TrayItem) => void;
  remove: (path: string) => void;
  has: (path: string) => boolean;
} {
  const items = useSyncExternalStore(subscribeTray, getTray, () => EMPTY);
  return {
    items,
    add: (item) => writeTray([item, ...getTray().filter((i) => i.path !== item.path)]),
    remove: (path) => writeTray(getTray().filter((i) => i.path !== path)),
    has: (path) => items.some((i) => i.path === path),
  };
}
