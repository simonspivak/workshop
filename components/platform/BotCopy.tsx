"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/platform/ui";

/** Текст для копирования: характер, «Мой текст», поля формы («Забери бота с собой»). */
export function BotCopy({ title, text, rows = 10 }: { title: string; text: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  const id = `copy-${title.replace(/[^a-zа-яё0-9]+/gi, "-").toLowerCase()}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер недоступен (старый браузер или запрет): текст можно выделить вручную
      (document.getElementById(id) as HTMLTextAreaElement | null)?.select();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          {title}
        </label>
        <button type="button" onClick={copy} className={buttonClass("secondary", "sm")}>
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
      <textarea
        id={id}
        readOnly
        value={text}
        rows={rows}
        className="mt-2 block w-full rounded-2xl border border-ink/15 bg-paper px-4 py-3 font-mono text-sm leading-relaxed"
      />
    </div>
  );
}
