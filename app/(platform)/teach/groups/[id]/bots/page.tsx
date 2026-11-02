import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { listGroupBots } from "@/lib/server/bot/dal";
import { addDays, formatDay } from "@/lib/server/bot/lifetime";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { requireStaff } from "@/lib/server/dal/auth";
import { ageBandLabels } from "@/lib/platform/messages";
import { Badge, Card, Container, PageTitle, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = { title: "Боты группы" };

/*
  Боты учеников группы (только чтение): инструменты, Telegram, число заявок и сообщений гостей.
  Содержимое заявок и переписки здесь не показываем — только счётчики.
*/

export default function GroupBotsPage({ params }: PageProps<"/teach/groups/[id]/bots">) {
  return (
    <Container>
      <Suspense fallback={<Skeleton className="mt-10 h-96" />}>
        <GroupBots params={params} />
      </Suspense>
    </Container>
  );
}

async function GroupBots({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const result = await listGroupBots(user, id);
  if (!result) notFound();
  const { group, bots } = result;
  const lastDay = group.endsOn ? addDays(group.endsOn, BOT_LIMITS.retireAfterDays) : null;

  return (
    <>
      <Link
        href={`/teach/groups/${group.id}`}
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> К группе
      </Link>
      <PageTitle eyebrow={`Группа ${group.code}`} title="Боты группы">
        {lastDay
          ? `Боты учеников работают до ${formatDay(lastDay)} (последний урок + ${BOT_LIMITS.retireAfterDays} дней).`
          : "Дата последнего урока не задана: боты работают без срока."}
      </PageTitle>

      {bots.length === 0 ? (
        <Card>
          <p className="text-ink-soft">Ученики группы ещё не создали ботов.</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {bots.map((bot) => (
            <li key={bot.botId} className="rounded-3xl bg-white p-5 ring-1 ring-ink/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display font-semibold">{bot.name}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">
                    {bot.ownerNickname}
                    {bot.ownerLogin && <span className="font-mono text-xs"> · {bot.ownerLogin}</span>} ·{" "}
                    {ageBandLabels[bot.ownerAgeBand]}
                  </p>
                </div>
                <Link
                  href={`/b/${bot.slug}`}
                  target="_blank"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-violet hover:bg-lavender"
                >
                  Открыть <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {bot.tools.leads && <Badge>заявки</Badge>}
                {bot.tools.image && <Badge>открытка</Badge>}
                {bot.tools.knowledge && <Badge>мой текст</Badge>}
                {bot.telegramUsername && <Badge tone="violet">@{bot.telegramUsername}</Badge>}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-paper p-3">
                  <dt className="font-mono text-xs text-ink-soft">Заявок</dt>
                  <dd className="mt-1 font-display text-2xl font-bold tabular-nums">{bot.leadsCount}</dd>
                </div>
                <div className="rounded-2xl bg-paper p-3">
                  <dt className="font-mono text-xs text-ink-soft">Сообщений гостей за неделю</dt>
                  <dd className="mt-1 font-display text-2xl font-bold tabular-nums">{bot.guestMessagesWeek}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
