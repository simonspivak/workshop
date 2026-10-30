import { Send } from "lucide-react";
import { config } from "@/content/config";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { telegramUrl } from "@/components/ContactLinks";

export function Booking() {
  const { booking } = site;
  const hasCalendar = config.bookingUrl.trim() !== "";

  return (
    <section aria-labelledby="date-title" id="date" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="max-w-2xl">
        <h2 id="date-title" className="text-3xl font-bold sm:text-4xl">
          {booking.title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{booking.text}</p>
      </div>

      {hasCalendar ? (
        <iframe
          src={config.bookingUrl}
          title={booking.iframeTitle}
          loading="lazy"
          className="mt-8 h-[680px] w-full rounded-2xl border border-ink/10 bg-white"
        />
      ) : (
        <div className="on-dark mt-8 flex flex-col items-start gap-6 rounded-2xl bg-ink p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <p className="max-w-xl text-lg">{booking.fallbackText}</p>
          <ButtonLink href={telegramUrl()} variant="sun" external>
            <Send aria-hidden="true" className="size-5" />
            {booking.telegramButton}
          </ButtonLink>
        </div>
      )}
    </section>
  );
}
