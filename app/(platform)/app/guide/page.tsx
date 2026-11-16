import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/server/dal/auth";
import { CopyButton } from "@/components/platform/CopyButton";
import { CopyPhrase, PrintButton } from "@/components/platform/GuideCopy";
import { Container, PageTitle, Skeleton } from "@/components/platform/ui";
import {
  guideMeta,
  guideSections,
  type GuideBlock,
  type GuideCell,
  type GuideRecipe,
  type GuideResource,
  type GuideStep,
  type GuideTable,
} from "@/content/guide";

export const metadata: Metadata = { title: "Киношпаргалка" };

/*
  Методичка «Киношпаргалка» (content/guide.ts). Заголовок и оглавление — в статичной оболочке,
  сама шпаргалка — за Suspense после проверки входа (как остальной кабинет; ведущие тоже видят).
  Печать: стили @media print в app/globals.css (класс guide-doc), кнопка — window.print().
*/
export default function GuidePage() {
  return (
    <Container className="guide-doc">
      <Link
        href="/app"
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:underline print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> В кабинет
      </Link>
      <PageTitle eyebrow={guideMeta.eyebrow} title={guideMeta.title}>
        {guideMeta.lead}
      </PageTitle>
      <div className="mb-8 print:hidden">
        <PrintButton />
      </div>

      <nav aria-labelledby="guide-toc-title" className="guide-keep mb-10 rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6">
        <h2 id="guide-toc-title" className="text-lg font-semibold">
          Содержание
        </h2>
        <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {guideSections.map((section, i) => (
            <li key={section.id} className="flex gap-2">
              <span className="w-6 shrink-0 font-mono text-sm text-ink-soft">{i + 1}.</span>
              <a href={`#${section.id}`} className="font-semibold text-violet underline-offset-4 hover:underline">
                {section.title}
                <span className="block text-sm font-normal text-ink-soft">{section.short}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Suspense fallback={<GuideSkeleton />}>
        <Guide />
      </Suspense>
    </Container>
  );
}

async function Guide() {
  await requireUser();
  return (
    <div className="space-y-14">
      {guideSections.map((section, i) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-6">
          <h2 id={`${section.id}-title`} className="text-2xl font-bold sm:text-3xl">
            <span className="mr-2 font-mono text-base text-ink-soft">{i + 1}.</span>
            {section.title}
          </h2>
          <div className="mt-5 space-y-6">
            {section.blocks.map((block, j) => (
              <Block key={j} block={block} />
            ))}
          </div>
          <p className="mt-6 print:hidden">
            <a href="#guide-toc-title" className="text-sm font-semibold text-violet hover:underline">
              ↑ К содержанию
            </a>
          </p>
        </section>
      ))}
    </div>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "text":
      return <p className="max-w-3xl text-lg leading-relaxed">{block.text}</p>;
    case "note":
      return (
        <div
          className={`guide-keep guide-card max-w-3xl rounded-2xl px-5 py-4 leading-relaxed ${
            block.tone === "warn" ? "bg-sun/40" : "bg-lavender"
          }`}
        >
          {block.title && <h3 className="font-display font-semibold">{block.title}</h3>}
          <p className={block.title ? "mt-1" : ""}>{block.text}</p>
        </div>
      );
    case "steps":
      return <Steps title={block.title} steps={block.steps} />;
    case "example":
      return (
        <div className="guide-keep guide-card rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6">
          <h3 className="text-lg font-semibold">{block.title}</h3>
          <p className="mt-1 text-ink-soft">{block.text}</p>
          <PromptBox text={block.en} copyLabel={`Копировать: ${block.title}`} />
        </div>
      );
    case "table":
      return <TableView table={block.table} />;
    case "rules":
      return (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {block.items.map((rule, i) => (
            <li key={i} className="guide-keep guide-card rounded-3xl bg-white p-5 ring-1 ring-ink/10">
              <h3 className="font-semibold">
                <span className="mr-1.5 font-mono text-sm text-ink-soft">{i + 1}.</span>
                {rule.title}
              </h3>
              <p className="mt-1 leading-relaxed">{rule.text}</p>
              {rule.en && (
                <div className="mt-3">
                  <CopyPhrase text={rule.en} />
                </div>
              )}
            </li>
          ))}
        </ol>
      );
    case "checklist":
      return (
        <ol className="guide-card max-w-3xl space-y-3 rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6">
          {block.items.map((item, i) => (
            <li key={i} className="guide-keep flex gap-3 leading-relaxed">
              <span aria-hidden="true" className="mt-1 size-4 shrink-0 rounded border-2 border-violet" />
              <span>
                <span className="sr-only">{i + 1}. </span>
                {item}
              </span>
            </li>
          ))}
        </ol>
      );
    case "resources":
      return <Resources items={block.items} />;
    case "recipes":
      return <Recipes title={block.title} items={block.items} />;
  }
}

function Steps({ title, steps }: { title: string; steps: GuideStep[] }) {
  return (
    <div className="guide-card rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      <ol className="mt-4 divide-y divide-ink/10">
        {steps.map((step, i) => (
          <li key={i} className="guide-keep grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4">
            <span className="font-mono text-sm leading-6 font-semibold text-violet">{i + 1}</span>
            <div>
              <p className="font-semibold">{step.title}</p>
              <p className="text-ink-soft">{step.text}</p>
            </div>
            {step.en && (
              <div className="col-start-2 mt-2 sm:col-start-3 sm:mt-0">
                <CopyPhrase text={step.en} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cell({ cell }: { cell: GuideCell }) {
  return typeof cell === "string" ? <>{cell}</> : <CopyPhrase text={cell.en} />;
}

/** Таблица от 640 px и на печати; на телефоне — карточки (таблица на телефоне скрыта целиком). */
function TableView({ table }: { table: GuideTable }) {
  const [head, ...rest] = table.columns;
  return (
    <>
      <div className="guide-table-wrap hidden overflow-x-auto rounded-3xl bg-white ring-1 ring-ink/10 sm:block print:block">
        <table className="guide-table w-full min-w-[40rem] border-collapse text-left text-sm">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr className="border-b border-ink/15 bg-lavender/60">
              {table.columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-3 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-ink/10 align-top last:border-b-0">
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-4 py-3 font-semibold">
                      <Cell cell={cell} />
                    </th>
                  ) : (
                    <td key={j} className="px-4 py-3 leading-relaxed">
                      <Cell cell={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={table.caption} className="guide-cards space-y-3 sm:hidden print:hidden">
        {table.rows.map((row, i) => {
          const [first, ...cells] = row;
          return (
            <li key={i} className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
              <p className="font-display font-semibold">
                <span className="sr-only">{head}: </span>
                <Cell cell={first} />
              </p>
              <dl className="mt-2 space-y-2 text-sm">
                {cells.map((cell, j) => (
                  <div key={j}>
                    <dt className="font-mono text-xs text-ink-soft uppercase">{rest[j]}</dt>
                    <dd className="mt-0.5 leading-relaxed">
                      <Cell cell={cell} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Resources({ items }: { items: GuideResource[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.url} className="guide-keep guide-card flex flex-col rounded-3xl bg-white p-5 ring-1 ring-ink/10">
          <h3 className="text-lg font-semibold">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-violet hover:underline"
            >
              {item.name}
              <ExternalLink aria-hidden="true" className="size-4 print:hidden" />
              <span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          </h3>
          <p className="font-mono text-xs text-ink-soft">{item.url.replace(/^https:\/\//, "")}</p>
          <p className="mt-2 leading-relaxed">{item.what}</p>
          <p className="mt-2 text-sm">
            <span className="font-semibold">Цена: </span>
            {item.cost}
          </p>
          {item.note && <p className="mt-1 text-sm text-ink-soft">{item.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function Recipes({ title, items }: { title: string; items: GuideRecipe[] }) {
  return (
    <div>
      <h3 className="text-xl font-semibold">{title}</h3>
      <ol className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((item) => (
          <li key={item.title} className="guide-keep guide-card flex flex-col rounded-3xl bg-white p-5 ring-1 ring-ink/10">
            <h4 className="font-display font-semibold">{item.title}</h4>
            <p className="mt-1 text-ink-soft">{item.gives}</p>
            <PromptBox text={item.prompt} copyLabel={`Копировать промпт: ${item.title}`} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function PromptBox({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <div className="mt-3 flex flex-1 flex-col gap-3">
      <p lang="en" className="flex-1 rounded-2xl bg-lavender p-4 font-mono text-[0.8125rem] leading-relaxed break-words">
        {text}
      </p>
      <div className="print:hidden">
        <CopyButton text={text} ariaLabel={copyLabel} />
      </div>
    </div>
  );
}

function GuideSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
