import { ArrowDown, CalendarDays, Check } from "lucide-react";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { ChatMock } from "@/components/home/ChatMock";

function HighlightedTitle({ title, highlight }: { title: string; highlight: string }) {
  const index = highlight ? title.indexOf(highlight) : -1;
  if (index === -1) return <>{title}</>;
  return (
    <>
      {title.slice(0, index)}
      <span className="marker">{highlight}</span>
      {title.slice(index + highlight.length)}
    </>
  );
}

export function Hero() {
  const { hero } = site;

  return (
    <div className="relative overflow-hidden">
      {/* Мягкое лиловое свечение за первым экраном */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 -right-40 size-[44rem] rounded-full bg-[radial-gradient(closest-side,var(--color-glow),transparent)] lg:-right-20"
      />
      <section
        aria-labelledby="hero-title"
        className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:pt-14 lg:pb-24"
      >
        <div>
          <p className="inline-block -rotate-2 rounded-full bg-sun px-3.5 py-1.5 font-mono text-sm font-medium">
            {hero.badge}
          </p>
          <h1
            id="hero-title"
            className="mt-6 text-[2.1rem] leading-[1.12] font-bold sm:text-5xl lg:text-[3.3rem]"
          >
            <HighlightedTitle title={hero.title} highlight={hero.titleHighlight} />
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">{hero.lead}</p>

          <ul className="mt-8 flex flex-wrap gap-2">
            {hero.facts.map((fact) => (
              <li
                key={fact.label}
                className="rounded-full bg-white px-4 py-2 ring-1 ring-ink/10"
              >
                <span className="font-display font-semibold text-violet">{fact.value}</span>{" "}
                <span className="text-ink-soft">{fact.label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <ButtonLink href="/#date">
              <CalendarDays aria-hidden="true" className="size-5" />
              {site.ctaLabel}
            </ButtonLink>
            <a
              href="#route"
              className="inline-flex items-center gap-1.5 font-medium text-violet underline-offset-4 hover:underline"
            >
              {hero.secondaryLink}
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>

        <div className="relative">
          <ChatMock chat={hero.chat} />
          <div className="relative mt-4 ml-6 rounded-3xl bg-ink p-5 text-white sm:ml-12">
            <p className="font-display text-sm font-semibold text-sun">{hero.outcomeTitle}</p>
            <ul className="mt-3 space-y-2">
              {hero.outcomes.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sun" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
