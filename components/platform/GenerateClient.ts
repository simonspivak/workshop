"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isActiveJobStatus, type JobAction, type JobView, type MediaKind } from "@/lib/platform/generation-types";
import { CLIENT_MAX_POLLS, CLIENT_STOP_AFTER_REJECTS, clientFirstDelayMs, clientPollDelayMs, withVisibility } from "@/lib/platform/job-poll";

/*
  Браузерная часть генераций: запрос в /api/generate, опрос /api/jobs/[id] по расписанию
  lib/platform/job-poll.ts и «корзина референсов» — файлы, отмеченные в галерее кнопкой «Как референс».
  Корзина — удобство одного браузера (localStorage), сервер всё равно проверяет каждый путь.
*/

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export type GenerateResponse =
  | { ok: true; jobId: string; job: JobView | null; balance: number | null }
  | {
      ok: false;
      error: string;
      jobId?: string;
      /** длина файла в секундах, если сервер её сообщил (lipsync_audio: озвучка длиннее потолка) */
      seconds?: number;
      /** запрос не ушёл или ответ оборвался в сети */
      network?: boolean;
      /** 5xx без нашего JSON (таймаут Vercel 504 и т. п.): задача могла создаться и списать звёзды */
      infra?: boolean;
    };

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
  if (!response.ok && !data && response.status >= 500) {
    // ответил не наш маршрут, а платформа (функция оборвалась): ключ сохраняем, повтор не спишет дважды
    return { ok: false, error: "request_lost", infra: true };
  }
  if (!response.ok || !data || typeof data.jobId !== "string") {
    return {
      ok: false,
      error: typeof data?.error === "string" ? data.error : "server_error",
      jobId: typeof data?.jobId === "string" ? data.jobId : undefined,
      seconds: typeof data?.seconds === "number" && Number.isFinite(data.seconds) ? data.seconds : undefined,
    };
  }
  return {
    ok: true,
    jobId: data.jobId,
    job: (data.job as JobView | undefined) ?? null,
    balance: typeof data.balance === "number" ? data.balance : null,
  };
}

/** Ответ опроса: задача, отказ (401/403/404 — опрашивать дальше бессмысленно) или сбой (5xx, сеть). */
export type FetchJobResult = { kind: "job"; job: JobView } | { kind: "rejected"; status: number } | { kind: "error" };

export async function fetchJob(id: string): Promise<FetchJobResult> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { kind: "rejected", status: response.status };
    }
    if (!response.ok) return { kind: "error" };
    const data = (await response.json()) as { job?: JobView };
    return data.job ? { kind: "job", job: data.job } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/**
 * Почему карточка перестала опрашивать сервер: потолок запросов, вход закончился (401 — например,
 * ведущий сменил пароль, и сессии ученика закрылись), нет прав (403), задачи нет (404).
 */
export type LivePollStop = "ceiling" | "signed_out" | "session" | "gone";
export type LiveJob = { job: JobView; stopped: LivePollStop | null; refresh: () => void };

// Незавершённые карточки на странице: чем их больше, тем реже опрашивает каждая (crowdFactor)
let livePollers = 0;

const ageOf = (job: JobView) => Math.max(0, Date.now() - Date.parse(job.createdAt));

/**
 * Живое состояние задачи. Пока она не готова, спрашиваем сервер по расписанию
 * lib/platform/job-poll.ts: пауза растёт с возрастом задачи, у видео и музыки она длиннее,
 * со случайным разбросом. Во вкладке в фоне опрос редкий (раз в 45 с и реже), при возвращении — сразу проверка.
 * После CLIENT_MAX_POLLS запросов или отказа сервера опрос останавливается (stopped),
 * refresh() запускает его заново. onSettled — когда задача стала done или failed.
 */
export function useLiveJob(initial: JobView, onSettled?: (job: JobView) => void): LiveJob {
  const [job, setJob] = useState(initial);
  const [stopped, setStopped] = useState<LivePollStop | null>(null);
  const [run, setRun] = useState(0);
  const settledRef = useRef(onSettled);
  const jobRef = useRef(initial);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const active = isActiveJobStatus(job.status);
  const polling = active && stopped === null;
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let errors = 0;
    let rejects = 0;
    livePollers++;

    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };
    const stop = (reason: LivePollStop) => {
      cancelled = true;
      setStopped(reason);
    };
    async function tick() {
      timer = undefined;
      if (cancelled) return;
      if (polls >= CLIENT_MAX_POLLS) return stop("ceiling");
      polls++;
      const result = await fetchJob(jobRef.current.id);
      if (cancelled) return;
      if (result.kind === "rejected") {
        if (++rejects >= CLIENT_STOP_AFTER_REJECTS) return stop(result.status === 404 ? "gone" : result.status === 401 ? "signed_out" : "session");
      } else if (result.kind === "error") {
        errors++;
      } else {
        errors = 0;
        rejects = 0;
        jobRef.current = result.job;
        setJob(result.job);
        if (!isActiveJobStatus(result.job.status)) {
          settledRef.current?.(result.job);
          return;
        }
      }
      const current = jobRef.current;
      // в фоне — редко (CLIENT_HIDDEN_MIN_MS): результат сохранится и без возврата на вкладку
      schedule(
        withVisibility(
          clientPollDelayMs({ action: current.action, status: current.status, ageMs: ageOf(current), errors, crowd: livePollers }),
          document.visibilityState === "visible",
        ),
      );
    }
    const onVisible = () => {
      // вернулись на вкладку: проверить почти сразу, но вразнобой с соседними карточками
      if (document.visibilityState === "visible" && !cancelled) {
        schedule(300 + Math.random() * Math.min(livePollers, 24) * 250);
      }
    };

    const current = jobRef.current;
    schedule(clientFirstDelayMs({ action: current.action, status: current.status, ageMs: ageOf(current), crowd: livePollers }));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      livePollers--;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling, run]);

  const refresh = () => {
    if (stopped === "signed_out") {
      window.location.assign(loginAgainHref(window.location.pathname));
      return;
    }
    if (stopped === "session" || stopped === "gone") {
      window.location.reload(); // сессию и права восстановит только перезагрузка (вход заново)
      return;
    }
    setStopped(null);
    setRun((n) => n + 1);
  };

  return { job, stopped, refresh };
}

/** Вход заново с возвратом на эту страницу (вход принимает ?next= только для /app и /teach). */
export function loginAgainHref(pathname: string): string {
  return `/login?next=${encodeURIComponent(pathname)}`;
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
