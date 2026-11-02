import type { ReactNode } from "react";

/*
  Базовые элементы кабинета. Те же токены, что у сайта (app/globals.css):
  paper/ink/violet/sun, Unbounded для заголовков, JetBrains Mono для подписей.
  Тон — спокойный и взрослый: белые карточки, фиолетовый акцент, жёлтый — для важного.
*/

export const inputClass =
  "block w-full min-h-12 rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base text-ink " +
  "placeholder:text-ink-soft/70 focus-visible:border-violet disabled:opacity-60";

export const labelClass = "block text-sm font-semibold text-ink";

export const hintClass = "mt-1 text-sm text-ink-soft";

const buttonVariants = {
  primary: "bg-violet text-white hover:bg-violet-deep",
  secondary: "bg-white text-ink ring-1 ring-ink/15 hover:bg-lavender",
  sun: "bg-sun text-ink hover:bg-ink hover:text-white",
  danger: "bg-white text-coral-deep ring-1 ring-coral/40 hover:bg-coral hover:text-white",
};

export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const sizing = size === "sm" ? "min-h-10 px-4 py-2 text-sm" : "min-h-12 px-6 py-3 text-base";
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${buttonVariants[variant]}`;
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-6 pb-6 sm:pt-10">
      {eyebrow && <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">{eyebrow}</p>}
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-soft">{children}</div>}
    </header>
  );
}

export function Card({
  title,
  description,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6 ${className}`}>
      {title && <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>}
      {description && <p className="mt-1 text-ink-soft">{description}</p>}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

const badgeTones = {
  neutral: "bg-lavender text-ink",
  violet: "bg-violet text-white",
  sun: "bg-sun text-ink",
  warn: "bg-coral/15 text-coral-deep",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

const noticeTones = {
  info: "bg-lavender text-ink",
  warn: "bg-sun/40 text-ink",
  error: "bg-coral/15 text-coral-deep",
  success: "bg-violet/10 text-violet-deep",
};

export function Notice({
  tone = "info",
  children,
  className = "",
}: {
  tone?: keyof typeof noticeTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${noticeTones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-3xl bg-lavender ${className}`} />;
}

/** Число звёзд со знаком ★. */
export function Stars({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {value.toLocaleString("ru-RU")}
      <span aria-hidden="true">&nbsp;★</span>
      <span className="sr-only"> звёзд</span>
    </span>
  );
}
