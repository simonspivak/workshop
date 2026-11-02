import { Fragment, type ReactNode } from "react";

/** Простой Markdown ответа ИИ: **жирный**, `код`, списки «- » и «1. », заголовки «#». Без HTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
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
