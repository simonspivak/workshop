import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: site.workshopsPage.title,
};

export default function WorkshopsPage() {
  const page = site.workshopsPage;

  return (
    <section aria-labelledby="workshops-title" className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 id="workshops-title" className="text-3xl font-bold sm:text-5xl">
        {page.title}
      </h1>
      <p className="mt-6 text-lg text-ink-soft">{page.intro}</p>

      <ol className="mt-6 divide-y divide-ink/10 border-y border-ink/10">
        {site.route.items.map((workshop, i) => (
          <li key={workshop.title} className="flex items-baseline gap-4 py-5">
            <span className="font-display text-xl font-bold text-violet">{i + 1}</span>
            <span className="font-display text-xl font-semibold">{workshop.title}</span>
          </li>
        ))}
      </ol>

      <p className="mt-8 flex items-start gap-3 rounded-2xl bg-lavender p-5">
        <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-violet" />
        <span>{page.note}</span>
      </p>
    </section>
  );
}
