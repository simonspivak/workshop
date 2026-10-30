import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { config } from "@/content/config";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { ContactLinks } from "@/components/ContactLinks";
import { CountUp } from "@/components/CountUp";
import { ImageSlot } from "@/components/ImageSlot";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: site.about.title,
};

// Цвет карточек портфолио по порядку
const cardTones = [
  { card: "on-dark bg-violet text-white", stat: "text-sun" },
  { card: "bg-sun text-ink", stat: "text-ink" },
  { card: "bg-white text-ink ring-1 ring-ink/10", stat: "text-violet" },
  { card: "on-dark bg-ink text-white", stat: "text-pink" },
  { card: "bg-lavender text-ink", stat: "text-violet" },
];

export default function AboutPage() {
  const { about } = site;

  return (
    <>
      <section
        aria-labelledby="about-title"
        className="mx-auto grid max-w-6xl gap-10 px-4 pt-6 pb-16 sm:px-6 md:grid-cols-[minmax(0,20rem)_1fr] md:items-start lg:gap-16 lg:pt-12"
      >
        <ImageSlot
          src={config.hostPhoto}
          alt={about.photoAlt}
          placeholder={about.photoPlaceholder}
          aspect="aspect-square"
          sizes="(min-width: 768px) 20rem, 100vw"
          priority
          className="max-w-xs rounded-3xl md:max-w-none"
        />

        <div>
          <h1 id="about-title" className="text-4xl font-bold sm:text-5xl">
            {about.title}
          </h1>
          <p className="mt-3 text-lg font-medium text-violet">{about.role}</p>
          <div className="mt-6 space-y-3 text-lg leading-relaxed">
            {about.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-ink/10 py-6">
            {about.stats.map((stat) => (
              <li key={stat.label}>
                <CountUp
                  value={stat.value}
                  className="block font-display text-4xl font-bold text-violet"
                />
                <span className="mt-1 block text-ink-soft">{stat.label}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-2xl font-bold">{about.experienceTitle}</h2>
          <ul className="mt-4 space-y-3">
            {about.experience.map((item) => (
              <li key={item} className="flex gap-3 text-lg">
                <span aria-hidden="true" className="mt-3 size-2 shrink-0 rounded-full bg-sun ring-2 ring-violet" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="portfolio-title" className="border-t border-ink/10">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="portfolio-title" className="text-3xl font-bold sm:text-4xl">
            {about.portfolioTitle}
          </h2>
          <p className="mt-3 text-lg text-ink-soft">{about.portfolioIntro}</p>

          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {about.portfolio.map((item, i) => {
              const tone = cardTones[i % cardTones.length];
              return (
                <Reveal
                  as="li"
                  key={item.title}
                  delay={(i % 3) * 120}
                  className={`flex flex-col rounded-[2rem] p-7 transition-transform duration-300 motion-safe:hover:-translate-y-1.5 motion-safe:hover:-rotate-1 ${tone.card} ${
                    i === 0 ? "sm:col-span-2" : ""
                  }`}
                >
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <CountUp
                      value={item.stat.value}
                      className={`font-display text-6xl font-bold ${tone.stat}`}
                    />
                    <span className="font-mono text-sm">{item.stat.label}</span>
                  </p>
                  <h3 className="mt-6 text-xl font-semibold break-words">{item.title}</h3>
                  <p className="mt-2 leading-relaxed">{item.text}</p>
                </Reveal>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="contacts-title" className="bg-lavender">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center">
          <div>
            <h2 id="contacts-title" className="text-3xl font-bold">
              {about.contactsTitle}
            </h2>
            <p className="mt-3 text-ink-soft">{about.contactsText}</p>
            <ContactLinks className="mt-6" />
          </div>
          <div className="rounded-2xl bg-white p-6 sm:p-8">
            <p className="font-display text-xl font-semibold">{about.ctaText}</p>
            <div className="mt-6">
              <ButtonLink href="/#date">
                <CalendarDays aria-hidden="true" className="size-5" />
                {site.ctaLabel}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
