import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/** Вкладки «Моего бота». Ссылка на публичную страницу — только пока бот работает. */
export function BotNav({
  current,
  leadsCount,
  publicPath,
  retired,
}: {
  current: "settings" | "leads" | "export";
  leadsCount: number;
  publicPath: string | null;
  retired: boolean;
}) {
  const tabs = [
    ...(retired ? [] : [{ key: "settings", href: "/app/bot", label: "Настройки" }]),
    { key: "leads", href: "/app/bot/leads", label: `Заявки · ${leadsCount}` },
    { key: "export", href: "/app/bot/export", label: "Забери с собой" },
  ] as const;

  return (
    <nav aria-label="Мой бот" className="-mx-4 mb-6 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            tab.key === current ? "bg-ink text-white" : "bg-white ring-1 ring-ink/10 hover:bg-lavender"
          }`}
        >
          {tab.label}
        </Link>
      ))}
      {publicPath && !retired && (
        <Link
          href={publicPath}
          target="_blank"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-violet hover:bg-lavender"
        >
          Страница бота <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </nav>
  );
}
