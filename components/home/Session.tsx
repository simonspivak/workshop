import { site } from "@/content/site";

// Цвет каждого шага — и в полоске времени, и в номере
const stepColors = [
  "bg-lavender text-ink ring-1 ring-inset ring-violet/30",
  "bg-violet text-white",
  "bg-sun text-ink",
  "bg-ink text-white",
];

export function Session() {
  const { session } = site;
  const total = session.steps.reduce((sum, step) => sum + step.minutes, 0);

  return (
    <section aria-labelledby="session-title" className="border-t border-ink/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="session-title" className="text-3xl font-bold sm:text-4xl">
            {session.title}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">{session.intro}</p>
        </div>

        {/* Полоска: сколько времени занимает каждый шаг */}
        <div aria-hidden="true" className="mt-10 flex h-3 gap-1 overflow-hidden rounded-full">
          {session.steps.map((step, i) => (
            <span
              key={step.title}
              className={stepColors[i % stepColors.length]}
              style={{ flexGrow: step.minutes / total }}
            />
          ))}
        </div>

        <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {session.steps.map((step, i) => (
            <li key={step.title}>
              <div className="flex items-center gap-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full font-display font-bold ${stepColors[i % stepColors.length]}`}
                >
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-ink-soft">
                  ≈{step.minutes} {session.minutesLabel}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-ink-soft">{session.note}</p>
      </div>
    </section>
  );
}
