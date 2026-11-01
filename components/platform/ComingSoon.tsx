import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/server/dal/auth";
import { Container, PageTitle, Skeleton } from "@/components/platform/ui";

/** Заглушка раздела, который появится в следующих этапах. Только для вошедших. */
export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <Container>
      <PageTitle eyebrow="Скоро" title={title}>
        {text}
      </PageTitle>
      <Suspense fallback={<Skeleton className="h-12 w-40" />}>
        <BackLink />
      </Suspense>
    </Container>
  );
}

async function BackLink() {
  await requireUser();
  return (
    <Link href="/app" className="inline-flex items-center gap-2 font-semibold text-violet hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" /> В кабинет
    </Link>
  );
}
