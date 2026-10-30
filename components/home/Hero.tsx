import { ArrowDown, CalendarDays, Check } from "lucide-react";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { ImageSlot } from "@/components/ImageSlot";

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
    <section
      aria-labelledby="hero-title"
      className="mx-auto grid max-w-6xl gap-10 px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:pt-12 lg:pb-24"
    >
      <div>
        <p className="inline-flex items-center rounded-full bg-mist px-3 py-1 text-sm font-medium text-cobalt">
          {hero.badge}
        </p>
        <h1
          id="hero-title"
          className="mt-5 text-[2rem] leading-[1.15] font-bold sm:text-5xl lg:text-[3.4rem]"
        >
          <HighlightedTitle title={hero.title} highlight={hero.titleHighlight} />
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">{hero.lead}</p>

        <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-ink/10 py-5 sm:grid-cols-4">
          {hero.facts.map((fact) => (
            <li key={fact.label}>
              <span className="block font-display text-2xl font-semibold text-cobalt">
                {fact.value}
              </span>
              <span className="text-sm text-ink-soft">{fact.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
          <ButtonLink href="/#date">
            <CalendarDays aria-hidden="true" className="size-5" />
            {site.ctaLabel}
          </ButtonLink>
          <a
            href="#route"
            className="inline-flex items-center gap-1.5 font-medium text-cobalt underline-offset-4 hover:underline"
          >
            {hero.secondaryLink}
            <ArrowDown aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>

      <div>
        <ImageSlot
          {...hero.image}
          sizes="(min-width: 1024px) 45vw, 100vw"
          priority
          className="rounded-3xl"
        />
        <div className="relative -mt-8 ml-4 rounded-2xl bg-ink p-5 text-white sm:ml-10">
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
  );
}
