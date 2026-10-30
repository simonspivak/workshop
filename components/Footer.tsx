import { config } from "@/content/config";
import { site } from "@/content/site";
import { ContactLinks } from "@/components/ContactLinks";

export function Footer() {
  return (
    <footer className="on-dark bg-ink text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-display text-lg font-semibold">{config.courseName}</p>
          <p className="mt-2 max-w-md text-white/75">{site.footer.note}</p>
          <p className="mt-6 text-sm text-white/60">
            © {config.hostName}
          </p>
        </div>
        <div>
          <h2 className="font-display text-base font-semibold text-sun">
            {site.footer.contactsTitle}
          </h2>
          <ContactLinks className="mt-4" tone="dark" />
        </div>
      </div>
    </footer>
  );
}
