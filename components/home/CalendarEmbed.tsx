"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";

/**
 * Календарь Google загружается только по нажатию: до этого браузер
 * не подключается к Google, поэтому сайту не нужен cookie-баннер.
 */
export function CalendarEmbed({
  src,
  title,
  text,
  button,
  privacyNote,
  privacyLink,
}: {
  src: string;
  title: string;
  text: string;
  button: string;
  privacyNote: string;
  privacyLink: string;
}) {
  const [shown, setShown] = useState(false);

  if (shown) {
    return (
      <iframe
        src={src}
        title={title}
        className="mt-8 h-[680px] w-full rounded-2xl border border-ink/10 bg-white"
      />
    );
  }

  return (
    <div className="on-dark mt-8 flex flex-col items-start gap-5 rounded-2xl bg-ink p-6 text-white sm:p-8">
      <p className="max-w-xl text-lg">{text}</p>
      <button
        type="button"
        onClick={() => setShown(true)}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-sun px-6 py-3 text-base font-semibold text-ink transition-colors hover:bg-white"
      >
        <CalendarDays aria-hidden="true" className="size-5" />
        {button}
      </button>
      <p className="text-sm text-white/75">
        {privacyNote}{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-sun">
          {privacyLink}
        </Link>
      </p>
    </div>
  );
}
