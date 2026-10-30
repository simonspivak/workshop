import type { Metadata } from "next";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { config } from "@/content/config";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { ContactLinks } from "@/components/ContactLinks";
import { ImageSlot } from "@/components/ImageSlot";

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
                <span className="block font-display text-4xl font-bold text-cobalt">
                  {stat.value}
                </span>
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

          <ul className="mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {about.portfolio.map((item) => (
              <li key={item.title} className="border-t-2 border-ink pt-5">
                {item.stat && (
                  <p className="flex items-baseline gap-2">
                    <span className="font-display text-4xl font-bold text-cobalt">{item.stat.value}</span>
                    <span className="text-ink-soft">{item.stat.label}</span>
                  </p>
                )}
                <h3 className="mt-3 text-lg font-semibold break-words">{item.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-soft">{item.text}</p>
                {item.image && (
                  <ImageSlot
                    {...item.image}
                    aspect="aspect-[2/1]"
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="mt-4 rounded-xl border border-ink/10 [&_img]:object-left-top"
                  />
                )}
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 font-medium text-cobalt underline-offset-4 hover:underline"
                  >
                    {item.linkLabel ?? item.link}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                    <span className="sr-only">(открывается в новой вкладке)</span>
                  </a>
                )}
              </li>
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
