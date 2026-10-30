import { AtSign, Camera, FolderGit2, Mail, Send } from "lucide-react";
import { config } from "@/content/config";

export function telegramUrl() {
  return `https://t.me/${config.contacts.telegram}`;
}

export function ContactLinks({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const { telegram, instagram, github, email } = config.contacts;
  const links = [
    telegram && { icon: Send, label: "Telegram", value: `@${telegram}`, href: telegramUrl() },
    instagram && {
      icon: Camera,
      label: "Instagram",
      value: `@${instagram}`,
      href: `https://instagram.com/${instagram}`,
    },
    github && {
      icon: FolderGit2,
      label: "GitHub",
      value: github,
      href: `https://github.com/${github}`,
    },
    email
      ? { icon: Mail, label: "E-mail", value: email, href: `mailto:${email}` }
      : { icon: AtSign, label: "E-mail", value: "скоро появится", href: "" },
  ].filter((link) => !!link);

  const muted = tone === "dark" ? "text-white/60" : "text-ink-soft";
  const hover = tone === "dark" ? "hover:text-sun" : "hover:text-cobalt";

  return (
    <ul className={`space-y-3 ${className}`}>
      {links.map(({ icon: Icon, label, value, href }) => (
        <li key={label} className="flex items-center gap-3">
          <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
          <span className={`w-24 shrink-0 text-sm ${muted}`}>{label}</span>
          {href ? (
            <a
              href={href}
              className={`font-medium underline-offset-4 hover:underline ${hover}`}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {value}
            </a>
          ) : (
            <span className={muted}>{value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
