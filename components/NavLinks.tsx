"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { label: string; href: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Основное меню">
      <ul className="flex items-center gap-1 text-sm sm:gap-2 sm:text-base">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-2.5 py-2 font-medium whitespace-nowrap sm:px-3 transition-colors hover:bg-lavender ${
                  active ? "bg-lavender text-violet" : ""
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
