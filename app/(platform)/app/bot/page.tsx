import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  connectTelegram,
  createBot,
  disconnectTelegram,
  resetPreview,
  saveBot,
  sendPreviewMessage,
  startPreviewCard,
} from "./actions";
import { getMyBot, getPreviewHistory, listMyImages } from "@/lib/server/bot/dal";
import { daysLeftText, formatDay } from "@/lib/server/bot/lifetime";
import { BOT_LIMITS } from "@/lib/server/bot/limits";
import { defaultGreeting, parseSoulExtras } from "@/lib/server/bot/prompt";
import { requireUser } from "@/lib/server/dal/auth";
import { appUrl } from "@/lib/server/env";
import { BotChat } from "@/components/platform/BotChat";
import { BotCopy } from "@/components/platform/BotCopy";
import { BotCreateForm } from "@/components/platform/BotCreateForm";
import { BotNav } from "@/components/platform/BotNav";
import { BotSettingsForm } from "@/components/platform/BotSettingsForm";
import { BotTelegram } from "@/components/platform/BotTelegram";
import { Card, Container, Notice, PageTitle, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = { title: "Мой бот" };

// Проверка в конструкторе ждёт ответа модели (таймаут шлюза — 60 с)
export const maxDuration = 60;

export default function BotPage() {
  return (
    <Container>
      <Suspense fallback={<BotSkeleton />}>
        <BotConstructor />
      </Suspense>
    </Container>
  );
}

async function BotConstructor() {
  const user = await requireUser();
  const bot = await getMyBot(user);

  if (!bot) {
    return (
      <>
        <PageTitle eyebrow="Урок 3" title="Мой бот">
          Бот — это ваш герой с мозгом и правилами. У него своя страница со ссылкой, характер, заявки и открытки.
        </PageTitle>
        <Card title="Создать бота">
          <BotCreateForm action={createBot} maxLength={BOT_LIMITS.nameMax} />
        </Card>
      </>
    );
  }

  // Срок вышел — конструктор показывает «Забери бота с собой»
  if (bot.lifetime.retired) redirect("/app/bot/export");

  const [recent, history] = await Promise.all([listMyImages(user), getPreviewHistory(user, bot.id)]);
  // Текущий аватар может быть старше последних 24 картинок — тогда он всё равно должен быть в выборе
  const images =
    bot.avatarJobId && bot.avatarUrl && !recent.some((image) => image.jobId === bot.avatarJobId)
      ? [{ jobId: bot.avatarJobId, url: bot.avatarUrl, label: "Текущий аватар" }, ...recent]
      : recent;
  const extras = parseSoulExtras(bot.soul);
  const base = appUrl();
  const publicUrl = base ? `${base}${bot.publicPath}` : bot.publicPath;

  return (
    <>
      <PageTitle eyebrow="Урок 3 · Мой бот" title={bot.name}>
        Характер, инструменты и окна вашего бота. Справа — проверка: тот же мозг, что у гостей.
      </PageTitle>
      <BotNav current="settings" leadsCount={bot.leadsCount} publicPath={bot.publicPath} retired={false} />

      <div className="mb-6 space-y-3">
        {bot.lifetime.limited && bot.lifetime.lastDay && bot.lifetime.daysLeft !== null && (
          <Notice tone={bot.lifetime.daysLeft <= 3 ? "warn" : "info"}>
            Бот работает на платформе до {formatDay(bot.lifetime.lastDay)} ({daysLeftText(bot.lifetime.daysLeft)}). Потом он
            переедет: характер и набор для переноса забирайте во вкладке «Забери с собой».
          </Notice>
        )}
        {!bot.active && (
          <Notice tone="warn">Ведущий снял бота с публикации: гости видят «бот переехал». Проверка ниже не работает.</Notice>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <Card>
          <BotSettingsForm
            bot={{
              name: bot.name,
              slug: bot.slug,
              soul: bot.soul,
              knowledge: bot.knowledge,
              tools: bot.tools,
              avatarJobId: bot.avatarJobId,
            }}
            limits={{ nameMax: BOT_LIMITS.nameMax, soulMax: BOT_LIMITS.soulMax, knowledgeMax: BOT_LIMITS.knowledgeMax }}
            images={images}
            adult={bot.adult}
            prices={bot.prices}
            guestCards={bot.guestCards}
            saveAction={saveBot}
          />
        </Card>

        <div className="space-y-6 self-start lg:sticky lg:top-4">
          <section aria-labelledby="preview-title">
            <h2 id="preview-title" className="mb-3 text-lg font-semibold">
              Проверка
            </h2>
            <BotChat
              mode="preview"
              slug={bot.slug}
              botName={bot.name}
              avatarUrl={bot.avatarUrl}
              greeting={extras.greeting ?? defaultGreeting(bot.name)}
              buttons={extras.buttons}
              initialMessages={history}
              sendAction={sendPreviewMessage}
              startCardAction={startPreviewCard}
              resetAction={resetPreview}
              className="h-[34rem] max-h-[75dvh]"
            />
            <p className="mt-2 text-sm text-ink-soft">
              Отвечает по сохранённым настройкам. Ответ — {bot.prices.reply}&nbsp;★ с ваших звёзд. Заявки отсюда тоже
              сохраняются: так их удобно проверить.
            </p>
          </section>

          <Card title="Ссылка на бота" description="Её можно отправить в чат группы и открыть с телефона.">
            <BotCopy title="Адрес страницы" text={publicUrl} rows={1} />
          </Card>

          <Card title="Telegram">
            <BotTelegram
              allowed={bot.adult}
              telegram={bot.telegram}
              connectAction={connectTelegram}
              disconnectAction={disconnectTelegram}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function BotSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-6 h-10 w-80" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <Skeleton className="h-[40rem]" />
        <Skeleton className="h-[34rem]" />
      </div>
    </div>
  );
}
