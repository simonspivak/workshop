import { ArrowRight, Bot, Clapperboard, Flag, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { site } from "@/content/site";
import { Reveal } from "@/components/Reveal";

// Иконка для каждого воркшопа по порядку
const icons = [Sparkles, Clapperboard, Bot, TrendingUp];

/**
 * Главный визуальный ход страницы: четыре воркшопа — остановки
 * на одной линии маршрута, в конце — финиш.
 */
export function Route() {
  const { route } = site;

  return (
    <section aria-labelledby="route-title" id="route" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="max-w-2xl">
        <h2 id="route-title" className="text-3xl font-bold sm:text-5xl">
          {route.title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{route.intro}</p>
      </div>

      <ol className="mt-12">
        {route.items.map((workshop, i) => {
          const Icon = icons[i % icons.length];
          return (
            <li key={workshop.title} className="group relative grid grid-cols-[2.5rem_1fr] gap-x-3 pb-8 sm:gap-x-5 lg:grid-cols-[3.5rem_1fr] lg:gap-x-8">
              <span
                aria-hidden="true"
                className="absolute top-10 bottom-0 left-[18px] w-1 bg-violet lg:top-14 lg:left-[26px]"
              />
              <span
                aria-hidden="true"
                className="relative flex size-10 items-center justify-center rounded-full border-4 border-violet bg-sun font-display text-lg font-bold transition-transform motion-safe:group-hover:scale-110 lg:size-14 lg:text-2xl"
              >
                {i + 1}
              </span>

              <Reveal className="min-w-0 rounded-[2rem] bg-white p-5 ring-1 ring-ink/10 transition-[box-shadow] group-hover:ring-2 group-hover:ring-violet/40 sm:p-7 lg:p-9">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-lavender text-violet">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <p className="font-mono text-sm text-ink-soft">
                    {route.stationLabel.toLowerCase()} 0{i + 1}
                  </p>
                </div>
                <h3 className="mt-4 text-2xl font-bold sm:text-3xl">{workshop.title}</h3>
                <p className="mt-3 max-w-2xl text-lg leading-relaxed">{workshop.oneLiner}</p>

                <div className="mt-7 grid gap-7 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
                  <div>
                    <h4 className="font-mono text-sm text-ink-soft">{route.skillsTitle}</h4>
                    <ul className="mt-3 space-y-2">
                      {workshop.skills.map((skill) => (
                        <li key={skill} className="flex gap-3">
                          <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-violet" />
                          <span>{skill}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <h4 className="font-mono text-sm text-ink-soft">{route.toolsTitle}</h4>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {workshop.tools.map((tool) => (
                          <li
                            key={tool}
                            className="rounded-full bg-lavender px-3 py-1 text-sm font-medium"
                          >
                            {tool}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <p className="rounded-2xl bg-sun/40 p-4">
                      <span className="font-semibold">{route.takeawayTitle}: </span>
                      {workshop.takeaway}
                    </p>
                  </div>
                </div>
              </Reveal>
            </li>
          );
        })}

        <li className="grid grid-cols-[2.5rem_1fr] gap-x-3 sm:gap-x-5 lg:grid-cols-[3.5rem_1fr] lg:gap-x-8">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-violet text-white lg:size-14"
          >
            <Flag className="size-5 lg:size-6" />
          </span>
          <div className="pt-1 lg:pt-3">
            <h3 className="text-2xl font-bold">{route.finishTitle}</h3>
            <p className="mt-2 max-w-2xl text-lg">{route.finishText}</p>
            <Link
              href="/workshops"
              className="mt-4 inline-flex items-center gap-1.5 font-medium text-violet underline-offset-4 hover:underline"
            >
              {route.moreLink}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </li>
      </ol>
    </section>
  );
}
