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
        {config.courseName}
      </Link>
      <NavLinks items={site.nav} />
    </header>
  );
}
