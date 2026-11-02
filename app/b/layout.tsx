import Link from "next/link";

// Публичная страница бота: без шапки кабинета, с пометкой, что это ИИ-персонаж учебного курса
export default function PublicBotLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-ink/10 bg-paper">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-sun ring-4 ring-violet" />
          <Link href="/" className="font-display text-sm font-semibold">
            ИИ-старт
          </Link>
          <span className="font-mono text-xs text-ink-soft">/ бот</span>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-ink/10">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-sm text-ink-soft">
          <span>Сделано с ИИ на учебном курсе «ИИ-старт». Ответы пишет нейросеть, она может ошибаться.</span>
          <Link href="/privacy" className="underline underline-offset-4 hover:text-violet">
            Конфиденциальность
          </Link>
        </div>
      </footer>
    </>
  );
}
