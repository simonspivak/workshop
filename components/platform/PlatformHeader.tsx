import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/app/(platform)/login/actions";
import { getUser, isStaff } from "@/lib/server/dal/auth";
import { getMyBalance } from "@/lib/server/dal/student";
import { roleLabels } from "@/lib/platform/messages";
import { Stars } from "@/components/platform/ui";

/** Шапка кабинета. Сама шапка статична, данные пользователя подгружаются за Suspense. */
export function PlatformHeader() {
  return (
    <header className="border-b border-ink/10 bg-paper print:hidden">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-display text-sm font-semibold sm:text-base">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-sun ring-4 ring-violet" />
          <span className="truncate">ИИ-старт</span>
          <span className="hidden font-mono text-xs font-normal text-ink-soft min-[400px]:inline">/ кабинет</span>
        </Link>
        <Suspense fallback={<div className="h-10 w-24" aria-hidden="true" />}>
          <UserNav />
        </Suspense>
      </div>
    </header>
  );
}

async function UserNav() {
  const user = await getUser();
  if (!user) {
    return (
      <Link href="/login" className="rounded-full px-3 py-2 text-sm font-semibold hover:bg-lavender">
        Войти
      </Link>
    );
  }

  const staff = isStaff(user);
  const balance = staff ? null : await getMyBalance(user);

  return (
    <nav aria-label="Кабинет" className="flex items-center gap-1 text-sm sm:gap-2">
      {staff ? (
        <Link href="/teach" className="rounded-full px-3 py-2 font-medium hover:bg-lavender">
          Группы
        </Link>
      ) : (
        <Link href="/app" className="rounded-full px-3 py-2 font-medium hover:bg-lavender">
          Главная
        </Link>
      )}
      <span className="hidden max-w-40 truncate text-ink-soft sm:inline" title={user.login ?? undefined}>
        {user.nickname}
        {staff && <span className="font-mono text-xs"> · {roleLabels[user.role]}</span>}
      </span>
      {balance !== null && (
        <span className="rounded-full bg-sun px-3 py-1.5 font-mono text-xs font-semibold">
          <Stars value={balance} />
        </span>
      )}
      <form action={logout}>
        <button
          type="submit"
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-lavender"
          aria-label="Выйти"
          title="Выйти"
        >
          <LogOut aria-hidden="true" className="size-5" />
        </button>
      </form>
    </nav>
  );
}
