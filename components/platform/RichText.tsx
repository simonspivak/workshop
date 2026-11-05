import { Fragment, type ReactNode } from "react";

/** Ячейки строки таблицы Markdown: «| a | b |» → ["a", "b"]. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Простой Markdown ответа ИИ: **жирный**, `код`, списки «- » и «1. », заголовки «#», таблицы «| a | b |». Без HTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  // Номер пункта берём из текста («3.» → 3): модели часто разделяют пункты пустой строкой
  // или прерывают список подзаголовком, и без этого каждый пункт начинался бы с «1.»
  let list: { ordered: boolean; items: { text: string; n: number | null }[] } | null = null;
  let table: string[][] | null = null;

  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    blocks.push(
      <div key={blocks.length} className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} className="border-b border-ink/20 px-2 py-1.5 align-top font-semibold">
                  {inline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {head.map((_, i) => (
                  <td key={i} className="border-b border-ink/10 px-2 py-1.5 align-top">
                    {inline(row[i] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = null;
  };

  const flush = () => {
    flushTable();
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
        {list.items.map((item, i) => (
          <li key={i} value={list!.ordered && item.n !== null ? item.n : undefined}>
            {inline(item.text)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (isTableRow(line) || (table && isTableDivider(line))) {
      if (list) flush();
      if (isTableDivider(line)) continue;
      table ??= [];
      table.push(tableCells(line));
      continue;
    }
    flushTable();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      if (numbered) {
        // «1. 1. 1.» (модель надеется на автонумерацию) — считаем сами, номера только растут
        const prev = list.items.length ? list.items[list.items.length - 1].n : null;
        const n = Number(numbered[1]);
        list.items.push({ text: numbered[2], n: prev !== null && n <= prev ? prev + 1 : n });
      } else {
        list.items.push({ text: bullet![1], n: null });
      }
      continue;
    }
    // пустая строка между пунктами списка его не обрывает
    if (!line.trim()) continue;
    // строка с отступом внутри списка — продолжение последнего пункта
    if (list && /^\s{2,}\S/.test(raw)) {
      const last = list.items[list.items.length - 1];
      last.text = `${last.text} ${line.trim()}`;
      continue;
    }
    flush();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1])}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();

  return <div className={`space-y-2 break-words ${className ?? ""}`}>{blocks}</div>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="rounded bg-white/70 px-1 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}
