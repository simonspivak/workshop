import "server-only";

/*
  Экспорт заявок в CSV для владельца бота.
  Разделитель «;» и BOM: так файл сразу открывается колонками в Excel с русской локалью,
  Google Таблицы и Numbers разделитель определяют сами.
  Значения, похожие на формулы (= + - @), экранируются апострофом (CSV-инъекция).
*/

export type CsvLead = { createdAt: string; channel: "web" | "telegram"; data: Record<string, unknown> };

const CHANNEL_LABELS = { web: "страница бота", telegram: "Telegram" } as const;

export function leadsToCsv(leads: CsvLead[], fieldOrder: string[] = []): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      columns.push(key);
    }
  };
  fieldOrder.forEach(add);
  for (const lead of leads) Object.keys(lead.data).forEach(add);

  const rows = [
    ["Дата", "Откуда", ...columns],
    ...leads.map((lead) => [
      formatDateTime(lead.createdAt),
      CHANNEL_LABELS[lead.channel] ?? lead.channel,
      ...columns.map((key) => stringify(lead.data[key])),
    ]),
  ];
  return "﻿" + rows.map((row) => row.map(escapeCell).join(";")).join("\r\n") + "\r\n";
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function escapeCell(value: string): string {
  let cell = value.replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[";\n,]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function formatDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
