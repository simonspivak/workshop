import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPublicBot } from "@/lib/server/bot/dal";
import { BOT_SESSION_COOKIE, isSessionId } from "@/lib/server/bot/secrets";
import { SLUG_RE } from "@/lib/server/bot/slug";
import { ConfigError, isSupabaseConfigured } from "@/lib/server/env";
import { BotChat } from "@/components/platform/BotChat";
import { Badge, Notice, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = { title: "Бот" };

export default function PublicBotPage({ params }: PageProps<"/b/[slug]">) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:py-8">
      <Suspense fallback={<ChatSkeleton />}>
        <PublicBot params={params} />
      </Suspense>
    </div>
  );
}

async function PublicBot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const session = (await cookies()).get(BOT_SESSION_COOKIE)?.value;
  if (!isSupabaseConfigured()) return <Notice>Платформа ещё не подключена.</Notice>;

  let view: Awaited<ReturnType<typeof getPublicBot>>;
  try {
    view = await getPublicBot(slug, isSessionId(session) ? session : null);
  } catch (error) {
    if (error instanceof ConfigError) return <Notice>Платформа ещё не подключена.</Notice>;
    throw error;
  }
  if (!view) notFound();

  if (view.state === "retired") {
    return (
      <section className="rounded-3xl bg-white p-6 text-center ring-1 ring-ink/10 sm:p-10">
        <BotAvatar url={view.avatarUrl} name={view.name} large center />
        <h1 className="mt-4 text-2xl font-bold sm:text-3xl">{view.name} переехал</h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-ink-soft">
          Курс закончился, и здесь бот больше не отвечает. Возможно, хозяин уже забрал его к себе — спросите у него новую
          ссылку.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-4">
        <BotAvatar url={view.avatarUrl} name={view.name} large />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{view.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <Badge tone="violet">ИИ-персонаж</Badge>
            <span>учебного курса «ИИ-старт», не человек</span>
          </p>
        </div>
      </header>

      <BotChat
        mode="public"
        slug={view.slug}
        botName={view.name}
        avatarUrl={view.avatarUrl}
        greeting={view.greeting}
        buttons={view.buttons}
        initialMessages={view.history}
        className="h-[calc(100dvh-16rem)] min-h-[26rem]"
      />

      <p className="text-sm text-ink-soft">
        {view.contactInLeads
          ? "Контакт оставляйте только для заявки. Заявку увидят владелец бота и ведущий курса."
          : view.leads
            ? "Заявку увидят владелец бота и ведущий курса. Телефон, e-mail и адрес здесь не нужны."
            : "Не пишите сюда телефон, адрес и другие личные данные."}
      </p>
    </div>
  );
}

function BotAvatar({ url, name, large = false, center = false }: { url: string | null; name: string; large?: boolean; center?: boolean }) {
  const size = `${large ? "size-16" : "size-10"}${center ? " mx-auto" : ""}`;
  if (url) {
    // Подписанная ссылка Storage на час
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ring-4 ring-violet/15`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-violet font-display text-xl font-semibold text-white`}
    >
      {name.trim().charAt(0).toUpperCase() || "Б"}
    </span>
  );
}

function ChatSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-[28rem]" />
    </div>
  );
}
