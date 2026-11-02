import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { config } from "@/content/config";
import { privacy } from "@/content/privacy";

export const metadata: Metadata = {
  title: privacy.title,
};

export default function PrivacyPage() {
  const { telegram, email } = config.contacts;

  return (
    <article aria-labelledby="privacy-title" className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 id="privacy-title" className="text-[min(1.6rem,calc((100vw_-_2rem)/15))] font-bold sm:text-5xl">
        {privacy.title}
      </h1>
      <p className="mt-3 font-mono text-sm text-ink-soft">{privacy.updated}</p>
      <p className="mt-6 text-lg leading-relaxed">{privacy.intro}</p>

      <section className="mt-10 rounded-3xl bg-lavender p-6">
        <h2 className="text-xl font-semibold">{privacy.contactHeading}</h2>
        <p className="mt-2 leading-relaxed">{privacy.contactText}</p>
        <ul className="mt-2 space-y-1">
          {email && (
            <li>
              <a href={`mailto:${email}`} className="font-medium text-violet underline-offset-4 hover:underline">
                {email}
              </a>
            </li>
          )}
          {telegram && (
            <li>
              <a
                href={`https://t.me/${telegram}`}
                className="font-medium text-violet underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Telegram @{telegram}
              </a>
            </li>
          )}
        </ul>
      </section>

      {privacy.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <div className="mt-3 space-y-3 leading-relaxed text-ink-soft">
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {section.link && (
            <a
              href={section.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 font-medium text-violet underline-offset-4 hover:underline"
            >
              {section.link.label}
              <ArrowUpRight aria-hidden="true" className="size-4" />
              <span className="sr-only">(открывается в новой вкладке)</span>
            </a>
          )}
        </section>
      ))}
    </article>
  );
}
