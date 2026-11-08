import "server-only";
import { LEAD_FIELD_HINTS, type LeadForm } from "@/lib/server/bot/tools";

/*
  «Забери бота с собой» (docs/platform/spec.md §5, docs/course/bot-kit/README.md):
  характер, «Мой текст» и форма заявки одним текстом — для копирования и файла «Скачать характер».
*/

export function leadFormText(form: LeadForm | null): string {
  if (!form) return "";
  const fields = form.fields.map(
    (f) =>
      `- ${f.label} — ${LEAD_FIELD_HINTS[f.type]}${f.type === "choice" && f.options?.length ? `: ${f.options.join(", ")}` : ""}${
        f.required ? "" : " (по желанию)"
      }`,
  );
  return [`Форма «${form.title}»:`, ...fields].join("\n");
}

export function soulExportText(input: {
  name: string;
  soul: string;
  knowledge: string;
  knowledgeEnabled: boolean;
  leadForm: LeadForm | null;
  pageUrl: string | null;
  kitUrl: string | null;
  exportedOn: string;
}): string {
  const line = "==========";
  const parts = [`ХАРАКТЕР БОТА — ${input.name}`];
  if (input.pageUrl) parts.push(`Страница на платформе «ИИ-старт»: ${input.pageUrl}`);
  parts.push(`Скачано: ${input.exportedOn}`, "", input.soul.trim() || "(характер пока пустой)");
  if (input.knowledge.trim()) {
    parts.push(
      "",
      line,
      `МОЙ ТЕКСТ — справка для инструмента «Ответы по моему тексту»${input.knowledgeEnabled ? "" : " (на платформе выключен)"}`,
      "",
      input.knowledge.trim(),
    );
  }
  if (input.leadForm) {
    parts.push("", line, "ЗАЯВКА — что бот собирает, переспрашивает «Всё верно?» и отправляет только после «да»", "", leadFormText(input.leadForm));
  }
  parts.push(
    "",
    line,
    "Как перенести бота к себе: набор «Забери бота с собой»" + (input.kitUrl ? ` — ${input.kitUrl}` : "."),
    "Токен Telegram и ключи — только в настройках скрипта или n8n. Не в код, не в чат, не на скриншот.",
  );
  return `${parts.join("\n")}\n`;
}
