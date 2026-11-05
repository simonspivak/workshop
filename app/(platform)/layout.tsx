import type { Metadata } from "next";
import Link from "next/link";
import { PlatformHeader } from "@/components/platform/PlatformHeader";

// В кабинете — просто «ИИ-старт»: число уроков зависит от группы (у 770 их пять).
export const metadata: Metadata = { title: { default: "Кабинет · ИИ-старт", template: "%s · ИИ-старт" } };

// Кабинет: своя шапка (вход, баланс, выход) и короткий подвал. Страницы читают сессию за <Suspense>.
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlatformHeader />
      <main id="main" className="flex-1 pb-16">
        {children}
      </main>
      <footer className="border-t border-ink/10 print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-5 text-sm text-ink-soft sm:px-6">
          <span>Кабинет курса «ИИ-старт»</span>
          <Link href="/privacy" className="underline underline-offset-4 hover:text-violet">
            Конфиденциальность
          </Link>
        </div>
      </footer>
    </>
  );
}
