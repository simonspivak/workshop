import { CalendarDays, Clock, Send } from "lucide-react";
import { config } from "@/content/config";
import { site } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { telegramUrl } from "@/components/ContactLinks";

/**
 * Встроить в страницу Google разрешает только ссылку из «Website embed»
 * (…/calendar/appointments/schedules/…?gv=true). Короткую ссылку
 * calendar.app.google открываем кнопкой.
 */
function embedUrl(url: string): string | null {
  if (!url.includes("/calendar/appointments/schedules/")) return null;
  if (url.includes("gv=true")) return url;
  return url + (url.includes("?") ? "&" : "?") + "gv=true";
}

export function Booking() {
  const { booking } = site;
  const url = config.bookingUrl.trim();
  const iframeSrc = url ? embedUrl(url) : null;

  return (
    <section aria-labelledby="date-title" id="date" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="max-w-2xl">
        <h2 id="date-title" className="text-3xl font-bold sm:text-4xl">
          {booking.title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{booking.text}</p>
        <p className="mt-4 flex gap-3 text-lg leading-relaxed">
          <Clock aria-hidden="true" className="mt-1 size-5 shrink-0 text-cobalt" />
          <span>{booking.schedule}</span>
        </p>
      </div>

      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          title={booking.iframeTitle}
          loading="lazy"
          className="mt-8 h-[680px] w-full rounded-2xl border border-ink/10 bg-white"
        />
      ) : (
        <div className="on-dark mt-8 flex flex-col items-start gap-6 rounded-2xl bg-ink p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <p className="max-w-xl text-lg">{url ? booking.calendarText : booking.fallbackText}</p>
          {url ? (
            <div className="flex flex-col items-start gap-4">
              <ButtonLink href={url} variant="sun" external>
                <CalendarDays aria-hidden="true" className="size-5" />
                {booking.calendarButton}
              </ButtonLink>
              <a
                href={telegramUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-medium text-white/85 underline-offset-4 hover:text-sun hover:underline"
              >
                <Send aria-hidden="true" className="size-4" />
                {booking.telegramButton}
              </a>
            </div>
          ) : (
            <ButtonLink href={telegramUrl()} variant="sun" external>
              <Send aria-hidden="true" className="size-5" />
              {booking.telegramButton}
            </ButtonLink>
          )}
        </div>
      )}
    </section>
  );
}
