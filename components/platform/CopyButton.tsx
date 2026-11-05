"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/platform/ui";

/** Текст в буфер обмена. Если Clipboard API недоступен (старый браузер, не https) — через выделение. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Копирование с отметкой «Скопировано» на 2 секунды. */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  async function copy(text: string) {
    const ok = await writeClipboard(text);
    if (timer.current) window.clearTimeout(timer.current);
    setCopied(ok);
    if (ok) timer.current = window.setTimeout(() => setCopied(false), 2000);
  }
  return { copied, copy };
}

export function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => copy(text)}>
      {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      {copied ? "Скопировано" : label}
    </button>
  );
}
