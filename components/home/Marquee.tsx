import { site } from "@/content/site";

/** Бегущая строка с инструментами курса. При «уменьшить движение» стоит на месте. */
export function Marquee() {
  const items = site.marquee;

  return (
    <div className="overflow-hidden bg-ink py-4 text-white">
      <p className="sr-only">Инструменты курса: {items.join(", ")}</p>
      <div aria-hidden="true" className="marquee-track flex w-max">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 items-center">
            {items.map((item) => (
              <li key={item} className="flex items-center font-display text-lg font-semibold whitespace-nowrap sm:text-xl">
                <span className="px-5">{item}</span>
                <span className="text-sun">✦</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
