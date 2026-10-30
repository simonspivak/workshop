import { ArrowUpRight, ThumbsUp, TriangleAlert } from "lucide-react";
import { site } from "@/content/site";
import type { AccessOption } from "@/lib/types";

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-sm text-current underline decoration-current/40 underline-offset-4 hover:decoration-current"
    >
      {label}
      <ArrowUpRight aria-hidden="true" className="size-3.5" />
      <span className="sr-only">(открывается в новой вкладке)</span>
    </a>
  );
}

const optionStyles: Record<AccessOption["verdict"], string> = {
  neutral: "border border-ink/15 bg-white",
  recommended: "on-dark bg-violet text-white md:-my-4 md:py-10",
  "not-recommended": "border-2 border-coral/60 bg-white",
};

function VerdictBadge({ option }: { option: AccessOption }) {
  if (option.verdict === "recommended") {
    return (
      <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-sun px-3 py-1 text-sm font-semibold text-ink">
        <ThumbsUp aria-hidden="true" className="size-4" />
        {option.verdictLabel}
      </span>
    );
  }
  if (option.verdict === "not-recommended") {
    return (
      <span className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-coral-deep">
        <TriangleAlert aria-hidden="true" className="size-4" />
        {option.verdictLabel}
      </span>
    );
  }
  return <span className="text-sm font-semibold text-ink-soft">{option.verdictLabel}</span>;
}

export function Access() {
  const { access } = site;

  return (
    <section aria-labelledby="access-title" className="bg-lavender">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-3xl">
          <h2 id="access-title" className="text-3xl font-bold sm:text-4xl">
            {access.title}
          </h2>
          <p className="mt-4 text-lg leading-relaxed">{access.problem}</p>
          <p className="mt-3 text-lg leading-relaxed font-semibold">{access.keyFact}</p>
        </div>

        <div className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-semibold">{access.factsTitle}</h3>
            <p className="text-sm text-ink-soft">{access.asOf}</p>
          </div>
          <ul className="mt-4 divide-y divide-ink/10 rounded-2xl bg-white">
            {access.facts.map((fact) => (
              <li
                key={fact.tool}
                className="grid gap-x-6 gap-y-2 p-4 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:p-5"
              >
                <div className="flex items-center justify-between gap-3 sm:block">
                  <p className="font-display font-semibold">{fact.tool}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm font-semibold sm:hidden ${
                      fact.ageLevel === "adult" ? "bg-ink text-white" : "bg-sun text-ink"
                    }`}
                  >
                    {fact.age}
                  </span>
                </div>
                <p className="text-ink-soft">
                  {fact.what}{" "}
                  <span className="text-violet">
                    <SourceLink href={fact.source} label={access.sourceLabel} />
                  </span>
                </p>
                <span
                  className={`hidden justify-self-end rounded-full px-2.5 py-0.5 text-center text-sm font-semibold sm:inline-block ${
                    fact.ageLevel === "adult" ? "bg-ink text-white" : "bg-sun text-ink"
                  }`}
                >
                  {fact.age}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-16">
          <h3 className="text-xl font-semibold">{access.optionsTitle}</h3>
          <ul className="mt-6 grid gap-5 md:grid-cols-3 md:items-stretch">
            {access.options.map((option) => (
              <li key={option.title} className={`flex flex-col rounded-2xl p-6 ${optionStyles[option.verdict]}`}>
                <VerdictBadge option={option} />
                <h4 className="mt-4 font-display text-xl font-semibold">{option.title}</h4>
                <p
                  className={`mt-1 font-medium ${
                    option.verdict === "recommended" ? "text-sun" : "text-violet"
                  }`}
                >
                  {option.price}
                </p>
                <div className="mt-4 space-y-3 leading-relaxed">
                  {option.text.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {option.minus && (
                    <p className="text-ink-soft">
                      <span className="font-semibold text-ink">Минус: </span>
                      {option.minus}
                    </p>
                  )}
                </div>
                {option.source && (
                  <p className="mt-auto pt-4 text-violet">
                    <SourceLink href={option.source} label={access.sourceLabel} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
