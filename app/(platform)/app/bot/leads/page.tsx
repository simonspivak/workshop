import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { getMyBotSummary, listMyLeads } from "@/lib/server/bot/dal";
import { requireUser } from "@/lib/server/dal/auth";
import { BotNav } from "@/components/platform/BotNav";
import { Card, Container, Notice, PageTitle, Skeleton, buttonClass } from "@/components/platform/ui";

export const metadata: Metadata = { title: "Заявки бота" };

const CHANNEL = { web: "страница", telegram: "Telegram" } as const;

export default function BotLeadsPage() {
  return (
    <Container>
      <Suspense fallback={<Skeleton className="mt-10 h-96" />}>
        <BotLeads />
      </Suspense>
    </Container>
  );
}

async function BotLeads() {
  const user = await requireUser();
  const [summary, result] = await Promise.all([getMyBotSummary(user), listMyLeads(user)]);
  if (!summary || !result) redirect("/app/bot");

  // Колонки: поля текущей формы, потом поля из старых заявок (если форму меняли)
  const columns = [...(result.form?.fields.map((f) => f.label) ?? [])];
  for (const lead of result.leads) for (const key of Object.keys(lead.data)) if (!columns.includes(key)) columns.push(key);

  return (
    <>
      <PageTitle eyebrow="Мой бот" title="Заявки">
        {result.form ? `Форма «${result.form.title}».` : "Форма заявки пока не настроена."} Заявки видите только вы и
        ведущий курса. Бот их только записывает и прочитать не может.
      </PageTitle>
      <BotNav current="leads" leadsCount={summary.leadsCount} publicPath={summary.publicPath} retired={summary.lifetime.retired} />

      {result.leads.length === 0 ? (
        <Card>
          <p className="text-ink-soft">
            Заявок пока нет. Включите инструмент «Заявки» в настройках, проверьте его в чате справа и поделитесь ссылкой на
            бота.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/app/bot/leads.csv" className={buttonClass("secondary", "sm")} download>
              <Download aria-hidden="true" className="size-4" /> Скачать CSV
            </a>
            <span className="text-sm text-ink-soft">Открывается в Excel, Google Таблицах и Numbers.</span>
          </div>
          <Notice>На уроке — только выдуманные данные. После события заявки с настоящими контактами лучше удалить.</Notice>

          {/* Телефон: карточки */}
          <ul className="space-y-3 sm:hidden">
            {result.leads.map((lead) => (
              <li key={lead.id} className="rounded-3xl bg-white p-4 ring-1 ring-ink/10">
                <p className="font-mono text-xs text-ink-soft">
                  {formatDateTime(lead.createdAt)} · {CHANNEL[lead.channel]}
                </p>
                <dl className="mt-2 space-y-1">
                  {columns
                    .filter((key) => lead.data[key])
                    .map((key) => (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0 text-ink-soft">{key}:</dt>
                        <dd className="min-w-0 break-words">{lead.data[key]}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>

          {/* Планшет и компьютер: таблица */}
          <div className="hidden overflow-x-auto rounded-3xl bg-white ring-1 ring-ink/10 sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-lavender/60 font-mono text-xs text-ink-soft uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Когда
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Откуда
                  </th>
                  {columns.map((key) => (
                    <th key={key} scope="col" className="px-4 py-3 font-medium normal-case">
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {result.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(lead.createdAt)}</td>
                    <td className="px-4 py-3">{CHANNEL[lead.channel]}</td>
                    {columns.map((key) => (
                      <td key={key} className="max-w-64 px-4 py-3 break-words">
                        {lead.data[key] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}
