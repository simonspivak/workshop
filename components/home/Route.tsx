import { ArrowRight, Flag } from "lucide-react";
import Link from "next/link";
import { site } from "@/content/site";
import { ImageSlot } from "@/components/ImageSlot";

/**
 * Главный визуальный ход страницы: четыре воркшопа — остановки
 * на одной линии маршрута, в конце — финиш.
 */
export function Route() {
  const { route } = site;

  return (
    <section aria-labelledby="route-title" id="route" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="max-w-2xl">
        <h2 id="route-title" className="text-3xl font-bold sm:text-4xl">
          {route.title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{route.intro}</p>
      </div>

      <ol className="mt-12">
        {route.items.map((workshop, i) => (
          <li key={workshop.title} className="relative grid grid-cols-[2.5rem_1fr] gap-x-4 pb-16 lg:grid-cols-[3.5rem_1fr] lg:gap-x-8">
            <span
              aria-hidden="true"
              className="absolute top-10 bottom-0 left-[18px] w-1 bg-cobalt lg:top-14 lg:left-[26px]"
            />
            <span
              aria-hidden="true"
              className="relative flex size-10 items-center justify-center rounded-full border-4 border-cobalt bg-sun font-display text-lg font-bold lg:size-14 lg:text-2xl"
            >
              {i + 1}
            </span>

            <div className="min-w-0 pt-1 lg:pt-2">
              <p className="text-sm font-medium text-cobalt">
                {route.stationLabel} {i + 1}
              </p>
              <h3 className="mt-1 text-2xl font-bold sm:text-3xl">{workshop.title}</h3>
              <p className="mt-3 max-w-2xl text-lg leading-relaxed">{workshop.oneLiner}</p>

              <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_minmax(0,24rem)]">
                <ImageSlot
                  {...workshop.image}
                  sizes="(min-width: 1024px) 24rem, 100vw"
                  className="rounded-2xl lg:order-2"
                />

                <div className="space-y-6 lg:order-1">
                  <div>
                    <h4 className="font-semibold">{route.skillsTitle}</h4>
                    <ul className="mt-3 space-y-2">
                      {workshop.skills.map((skill) => (
                        <li key={skill} className="flex gap-3">
                          <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-cobalt" />
                          <span>{skill}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold">{route.toolsTitle}</h4>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {workshop.tools.map((tool) => (
                        <li
                          key={tool}
                          className="rounded-full border border-cobalt/30 bg-white px-3 py-1 text-sm font-medium"
                        >
                          {tool}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="border-l-4 border-sun pl-4">
                    <span className="font-semibold">{route.takeawayTitle}: </span>
                    {workshop.takeaway}
                  </p>
                </div>
              </div>
            </div>
          </li>
        ))}

        <li className="grid grid-cols-[2.5rem_1fr] gap-x-4 lg:grid-cols-[3.5rem_1fr] lg:gap-x-8">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-cobalt text-white lg:size-14"
          >
            <Flag className="size-5 lg:size-6" />
          </span>
          <div className="pt-1 lg:pt-3">
            <h3 className="text-2xl font-bold">{route.finishTitle}</h3>
            <p className="mt-2 max-w-2xl text-lg">{route.finishText}</p>
            <Link
              href="/workshops"
              className="mt-4 inline-flex items-center gap-1.5 font-medium text-cobalt underline-offset-4 hover:underline"
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
