import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Bot, Clapperboard, Film, Images } from "lucide-react";
import { hasCourseAccess, requireUser, isStaff } from "@/lib/server/dal/auth";
import { getStudentHome } from "@/lib/server/dal/student";
import { listLessons } from "@/lib/server/course";
import { listMyOpenJobs } from "@/lib/server/gallery";
import { ledgerReasonLabels } from "@/lib/platform/messages";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/time-zone";
import { GenerateJobCard } from "@/components/platform/GenerateJobCard";
import { Card, Container, Notice, PageTitle, Skeleton, Stars } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Кабинет",
};

const tools = [
  { href: "/app/gallery", title: "Галерея", text: "Все ваши картинки, озвучки и клипы.", icon: Images },
  { href: "/app/bot", title: "Мой бот", text: "Бот с вашим «характером»: веб-чат и Telegram.", icon: Bot },
  { href: "/app/studio", title: "Монтаж", text: "Склейка клипов, реплик и музыки в один ролик.", icon: Clapperboard },
  { href: "/app/guide", title: "Киношпаргалка", text: "Свет, планы, ракурсы, камера и готовые промпты.", icon: Film },
] as const;

export default function StudentHomePage() {
  return (
    <Container>
      <Suspense fallback={<HomeSkeleton />}>
        <StudentHome />
      </Suspense>
    </Container>
  );
}

async function StudentHome() {
  const user = await requireUser();
  const [home, lessons, openJobs] = await Promise.all([
    getStudentHome(user),
    Promise.resolve(listLessons()),
    listMyOpenJobs(user),
  ]);
  const staff = isStaff(user);
  // ученик без группы курс не видит (аудит № 58): уроки, студия и генерации ведут обратно сюда
  const course = hasCourseAccess(user);

  return (
    <>
      <PageTitle eyebrow={user.group ? `Группа ${user.group.code} · ${user.group.title}` : "Кабинет"} title={user.nickname} />

      {staff && (
        <Notice className="mb-6">
          Вы вошли как ведущий: генерации для вас бесплатные.{" "}
          <Link href="/teach" className="font-semibold text-violet underline underline-offset-4">
            Перейти к группам
          </Link>
        </Notice>
      )}
      {!course && (
        <Notice tone="warn" className="mb-6">
          Аккаунт не привязан к группе: уроки и генерации недоступны. Обратитесь к ведущему.
        </Notice>
      )}
      {user.group?.paused && (
        <Notice tone="warn" className="mb-6">
          Ведущий поставил группу на паузу: генерации временно недоступны.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section aria-labelledby="balance-title" className="on-dark rounded-3xl bg-violet p-6 text-white">
          <h2 id="balance-title" className="font-mono text-xs tracking-wide text-white/75 uppercase">
            Баланс
          </h2>
          <p className="mt-3 font-display text-5xl font-bold">
            <Stars value={home.balance} />
          </p>
          <p className="mt-3 text-white/80">
            Звёзды тратятся на генерации: цена написана на каждой кнопке. Если генерация не удалась, звёзды
            возвращаются.
          </p>
        </section>

        <Card title="Последние операции">
          {home.recent.length === 0 ? (
            <p className="text-ink-soft">Пока ничего.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {home.recent.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">{entry.note || ledgerReasonLabels[entry.reason] || entry.reason}</span>
                    <time dateTime={entry.createdAt} className="font-mono text-xs text-ink-soft">
                      {formatDate(entry.createdAt)}
                    </time>
                  </span>
                  <span className={`font-mono font-semibold ${entry.delta > 0 ? "text-violet" : "text-ink"}`}>
                    {entry.delta > 0 ? "+" : "−"}
                    <Stars value={Math.abs(entry.delta)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {openJobs.length > 0 && (
        <section aria-labelledby="open-jobs-title" className="mt-10">
          <h2 id="open-jobs-title" className="text-2xl font-bold">
            Генерации в работе
          </h2>
          <p className="mt-2 text-ink-soft">
            Эти задачи ещё не закончились. Страница сама их проверит: готовое попадёт в галерею, а за неудачное звёзды
            вернутся.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {openJobs.map((job) => (
              <li key={job.id}>
                <GenerateJobCard job={job} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {course && (
        <section aria-labelledby="lessons-title" className="mt-10">
          <h2 id="lessons-title" className="text-2xl font-bold">
            Уроки
          </h2>
          <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={`/app/lessons/${lesson.n}`}
                  className="group flex h-full flex-col rounded-3xl bg-white p-5 ring-1 ring-ink/10 transition-colors hover:ring-violet sm:p-6"
                >
                  <span className="font-mono text-xs text-ink-soft">Урок {lesson.n}</span>
                  <span className="mt-2 font-display text-lg leading-snug font-semibold">{lesson.title}</span>
                  {lesson.oneLiner && <span className="mt-2 text-ink-soft">{lesson.oneLiner}</span>}
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-violet">
                    Открыть <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="tools-title" className="mt-10">
        <h2 id="tools-title" className="text-2xl font-bold">
          Инструменты
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map(({ href, title, text, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-full flex-col rounded-3xl bg-lavender p-5 transition-colors hover:bg-glow sm:p-6"
              >
                <Icon aria-hidden="true" className="size-6 text-violet" />
                <span className="mt-3 font-display font-semibold">{title}</span>
                <span className="mt-1 text-ink-soft">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="pt-10">
      <Skeleton className="h-10 w-48" />
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
      <Skeleton className="mt-10 h-40" />
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PLATFORM_TIME_ZONE,
  }).format(new Date(value));
}
