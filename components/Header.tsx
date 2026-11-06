import Link from "next/link";
import { config } from "@/content/config";
import { site } from "@/content/site";
import { NavLinks } from "@/components/NavLinks";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <Link
        href="/"
        className="flex min-w-0 items-center gap-2 font-display text-[13px] leading-tight font-semibold min-[400px]:text-sm sm:text-base"
      >
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full bg-sun ring-4 ring-violet"
        />
        {/* на телефоне — коротко, чтобы рядом поместились меню и «Войти» */}
        <span className="sr-only min-[400px]:not-sr-only min-[400px]:whitespace-nowrap min-[480px]:hidden">
          {config.courseName.split(":")[0]}
        </span>
        <span className="hidden min-[480px]:inline">{config.courseName}</span>
      </Link>
      <div className="flex items-center gap-1 sm:gap-2">
        <NavLinks items={site.nav} />
        {/* Вход в кабинет: ведущий попадает в кабинет учителя, ученик — в свои уроки */}
        <Link
          href="/login"
          className="rounded-full bg-violet px-3 py-2 text-[13px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-violet-deep min-[400px]:text-sm sm:px-4 sm:text-base"
        >
          Войти
        </Link>
      </div>
    </header>
  );
}
