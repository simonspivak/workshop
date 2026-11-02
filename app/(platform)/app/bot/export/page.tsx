import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Download, FileJson, FileText } from "lucide-react";
import { getMyBot } from "@/lib/server/bot/dal";
import { leadFormText } from "@/lib/server/bot/export";
import { daysLeftText, formatDay } from "@/lib/server/bot/lifetime";
import { requireUser } from "@/lib/server/dal/auth";
import { connectTelegram, disconnectTelegram } from "../actions";
import { BotCopy } from "@/components/platform/BotCopy";
import { BotNav } from "@/components/platform/BotNav";
import { BotTelegram } from "@/components/platform/BotTelegram";
import { Card, Container, Notice, PageTitle, Skeleton, buttonClass } from "@/components/platform/ui";

export const metadata: Metadata = { title: "Забери бота с собой" };

// Набор лежит в public/bot-kit (копия docs/course/bot-kit), шаблон n8n можно скачать файлом
const KIT = [
  { href: "/bot-kit/README.md", title: "Инструкция", text: "Что взять с платформы, где получить ключи и два пути переноса.", icon: FileText },
  {
    href: "/bot-kit/prompt-ai-studio.md",
    title: "Промпт для AI Studio или Claude",
    text: "Путь 1: ИИ пишет код бота для Google Apps Script — бесплатно, без сервера, около 30 минут.",
    icon: FileText,
  },
  {
    href: "/bot-kit/n8n-telegram-bot.json",
    title: "Шаблон n8n",
    text: "Путь 2: импортируйте в свой n8n, вставьте душу, токен Telegram и ключ Gemini.",
    icon: FileJson,
    download: "n8n-telegram-bot.json",
  },
] as const;

export default function BotExportPage() {
  return (
    <Container>
      <Suspense fallback={<Skeleton className="mt-10 h-96" />}>
        <BotExport />
      </Suspense>
    </Container>
  );
}

async function BotExport() {
  const user = await requireUser();
  const bot = await getMyBot(user);
  if (!bot) redirect("/app/bot");
  const { lifetime } = bot;
  const formText = leadFormText(bot.tools.leadForm);

  return (
    <>
      <PageTitle eyebrow="Мой бот" title="Забери бота с собой">
        Бот — это прежде всего душа: характер, манера и правила, которые вы придумали. Код можно написать заново, а душу
        заберите отсюда.
      </PageTitle>
      <BotNav current="export" leadsCount={bot.leadsCount} publicPath={bot.publicPath} retired={lifetime.retired} />

      <div className="space-y-6">
        {lifetime.retired && lifetime.lastDay ? (
          <Notice tone="warn">
            Бот работал на платформе до {formatDay(lifetime.lastDay)}. Курс закончился: страница бота показывает «бот
            переехал», Telegram отключён. Всё, что вы придумали, — ниже. Заявки по-прежнему во вкладке «Заявки».
          </Notice>
        ) : lifetime.limited && lifetime.lastDay && lifetime.daysLeft !== null ? (
          <Notice>
            Бот работает на платформе до {formatDay(lifetime.lastDay)} ({daysLeftText(lifetime.daysLeft)}), потом
            отключится. Перенесите его заранее.
          </Notice>
        ) : (
          <Notice>Ваш бот на платформе без срока. Набор ниже пригодится, если захотите свой собственный бот.</Notice>
        )}

        <Card title="1. Душа и тексты">
          <div className="space-y-6">
            <BotCopy title="Душа" text={bot.soul || "(душа пока пустая)"} rows={12} />
            {bot.knowledge.trim() && <BotCopy title="Мой текст" text={bot.knowledge} rows={8} />}
            {formText && <BotCopy title="Поля заявки" text={formText} rows={Math.min(8, formText.split("\n").length + 1)} />}
            <a href="/app/bot/soul.txt" download className={buttonClass("primary")}>
              <Download aria-hidden="true" className="size-5" /> Скачать душу (.txt)
            </a>
          </div>
        </Card>

        <Card title="2. Набор «Забери бота с собой»" description="Два пути. Оба бесплатные.">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {KIT.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  target={"download" in item ? undefined : "_blank"}
                  rel="noopener"
                  download={"download" in item ? item.download : undefined}
                  className="flex h-full flex-col rounded-3xl bg-lavender p-5 transition-colors hover:bg-glow"
                >
                  <item.icon aria-hidden="true" className="size-6 text-violet" />
                  <span className="mt-3 font-display font-semibold">{item.title}</span>
                  <span className="mt-1 text-sm text-ink-soft">{item.text}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="3. Что ещё понадобится">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Токен Telegram-бота от @BotFather. Подойдёт токен бота с курса: он остаётся вашим.
              {bot.telegram.connected && " Сначала отключите Telegram на платформе (кнопка ниже), иначе новый сервер не сможет подключиться."}
            </li>
            <li>Ключ Gemini из Google AI Studio (бесплатный тариф с лимитами).</li>
            <li>Ваш chat id — как его узнать, написано в инструкции.</li>
          </ul>
          <Notice className="mt-4" tone="warn">
            Токен и ключи — только в настройках скрипта или n8n. Не в код, не в чат, не на скриншот.
            {!bot.adult && " Оба пути — с 18 лет: так требуют условия Telegram и Gemini API. Делайте вместе со взрослым на его аккаунте."}
          </Notice>
        </Card>

        {bot.telegram.connected && (
          <Card title="Telegram на платформе">
            <BotTelegram allowed telegram={bot.telegram} connectAction={connectTelegram} disconnectAction={disconnectTelegram} />
          </Card>
        )}
      </div>
    </>
  );
}
