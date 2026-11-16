"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { buttonClass } from "@/components/platform/ui";

/** Набирает ли человек что-то прямо сейчас: тогда автообновление подождёт. */
function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/**
 * Кнопка «Обновить» и бережное автообновление страницы группы (аудит № 30):
 * раз в intervalMs, только пока вкладка видна и ведущий не печатает в поле; при возврате
 * на вкладку — сразу, если данные старше интервала. router.refresh() перечитывает данные
 * сервера и не трогает состояние форм (карточки пачек, раскрытые ученики, набранный текст).
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const last = useRef(0);

  const refresh = useCallback(() => {
    last.current = Date.now();
    startTransition(() => {
      router.refresh();
      setUpdatedAt(new Date());
    });
  }, [router]);

  useEffect(() => {
    last.current = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible" || isTyping()) return;
      if (Date.now() - last.current < intervalMs) return;
      refresh();
    };
    const timer = window.setInterval(tick, Math.min(intervalMs, 10_000));
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, refresh]);

  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" onClick={refresh} disabled={pending} className={buttonClass("secondary", "sm")}>
        <RefreshCw aria-hidden="true" className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Обновляем…" : "Обновить"}
      </button>
      <span className="text-sm text-ink-soft" aria-live="polite">
        {updatedAt ? `Обновлено в ${timeFormat.format(updatedAt)}` : `Обновляется само раз в ${Math.round(intervalMs / 1000)} с`}
      </span>
    </span>
  );
}
