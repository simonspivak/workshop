import type { Metadata } from "next";
import { ArrowUpRight, CalendarDays } from "lucide-react";
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
          <p className="mt-3 text-lg font-medium text-cobalt">{about.role}</p>
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
                  className="block font-display text-4xl font-bold text-cobalt"
                />
                <span className="mt-1 block text-ink-soft">{stat.label}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-2xl font-bold">{about.experienceTitle}</h2>
          <ul className="mt-4 space-y-3">
            {about.experience.map((item) => (
              <li key={item} className="flex gap-3 text-lg">
                <span aria-hidden="true" className="mt-3 size-2 shrink-0 rounded-full bg-sun ring-2 ring-cobalt" />
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

          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {about.portfolio.map((item, i) => (
              <Reveal
                as="li"
                key={item.title}
                delay={(i % 3) * 120}
                className={`group flex flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-ink/10 transition-[box-shadow] hover:ring-2 hover:ring-cobalt/50 ${
                  i === 0 ? "sm:col-span-2" : ""
                }`}
              >
                {item.image ? (
                  <div className="relative">
                    <ImageSlot
                      {...item.image}
                      aspect={i === 0 ? "aspect-[16/9] lg:aspect-[21/9]" : "aspect-[16/9]"}
                      sizes={i === 0 ? "(min-width: 1024px) 66vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"}
                      imgClassName="transition-transform duration-700 ease-out motion-safe:group-hover:scale-105"
                    />
                    {item.stat && (
                      <>
                        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/15 to-transparent" />
                        <p className="absolute bottom-4 left-5 flex items-baseline gap-2 text-white">
                          <CountUp value={item.stat.value} className="font-display text-4xl font-bold sm:text-5xl" />
                          <span className="text-white/85">{item.stat.label}</span>
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  item.stat && (
                    <p className="flex items-baseline gap-2 px-6 pt-6">
                      <CountUp value={item.stat.value} className="font-display text-4xl font-bold text-cobalt" />
                      <span className="text-ink-soft">{item.stat.label}</span>
                    </p>
                  )
                )}
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-lg font-semibold break-words">{item.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-soft">{item.text}</p>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-auto inline-flex items-center gap-1 pt-4 font-medium text-cobalt underline-offset-4 hover:underline"
                    >
                      {item.linkLabel ?? item.link}
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                      <span className="sr-only">(открывается в новой вкладке)</span>
                    </a>
                  )}
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="contacts-title" className="bg-mist">
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
