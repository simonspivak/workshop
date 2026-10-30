import Link from "next/link";
import type { ReactNode } from "react";

const styles = {
  primary:
    "bg-cobalt text-white hover:bg-cobalt-deep",
  sun: "bg-sun text-ink hover:bg-white",
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof styles;
  external?: boolean;
}) {
  const className = `inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition-colors ${styles[variant]}`;

  if (external) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
