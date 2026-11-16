"use client";

import { Check, Copy, Printer } from "lucide-react";
import { useCopy } from "@/components/platform/CopyButton";
import { buttonClass } from "@/components/platform/ui";

/** Английская фраза из шпаргалки: сама фраза — кнопка, нажатие копирует её. На печати — просто текст. */
export function CopyPhrase({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={`Скопировать: ${text}`}
      className="group inline-flex max-w-full items-start gap-2 rounded-xl bg-lavender px-2.5 py-1.5 text-left font-mono text-[0.8125rem] leading-snug text-ink transition-colors hover:bg-glow print:bg-transparent print:p-0"
    >
      <span lang="en" className="min-w-0 break-words">
        {text}
      </span>
      {copied ? (
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-violet print:hidden" />
      ) : (
        <Copy aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-soft group-hover:text-violet print:hidden" />
      )}
      <span role="status" className="sr-only">
        {copied ? "Скопировано" : ""}
      </span>
    </button>
  );
}

/** «Скачать PDF / Распечатать»: окно печати браузера, там «Сохранить как PDF». */
export function PrintButton() {
  return (
    <button type="button" className={`${buttonClass("secondary", "sm")} print:hidden`} onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-4" />
      Скачать PDF / Распечатать
    </button>
  );
}
