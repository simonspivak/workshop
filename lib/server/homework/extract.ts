import type { HomeworkExt } from "@/lib/platform/homework-types";
import { readZip, type ZipEntry } from "./zip";

/*
  Текст из файла домашки для проверки моделью. Без тяжёлых зависимостей:
    pptx → ppt/slides/slideN.xml по порядку номеров, только <a:t> (текст фигур);
    docx → word/document.xml, только <w:t> (абзацы, таблицы);
    pdf  → unpdf (pdf.js без canvas, работает в Node и на Vercel);
    txt, md → как есть.
  Картинки, видео и звук модель не читает — такие работы ждут оценки ведущего.
  Текст режется до MAX_EXTRACT_CHARS: модели хватает, а длинные работы не стоят лишних токенов.
*/

export const MAX_EXTRACT_CHARS = 15_000;

export type Extracted = {
  text: string;
  /** слайдов в презентации (урок 1 просит ровно 4) или страниц в PDF */
  slides: number | null;
  pages: number | null;
  truncated: boolean;
};

export type ExtractResult = { ok: true; content: Extracted } | { ok: false; error: "unreadable" | "empty" };

// ---------- XML ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Текст абзацев: внутри каждого <p>…</p> (a:p или w:p) склеиваются текстовые узлы <t>,
 * переносы строк <br/> и табуляции <tab/>. Абзацы — отдельными строками, пустые пропускаются.
 */
function paragraphs(xml: string, prefix: "a" | "w"): string[] {
  const result: string[] = [];
  const paragraphRe = new RegExp(`<${prefix}:p\\b[^>]*>([\\s\\S]*?)</${prefix}:p>`, "g");
  const partRe = new RegExp(`<${prefix}:t\\b[^>]*>([\\s\\S]*?)</${prefix}:t>|<${prefix}:br\\b[^>]*/>|<${prefix}:tab\\b[^>]*/>`, "g");
  for (const paragraph of xml.matchAll(paragraphRe)) {
    let text = "";
    for (const part of paragraph[1].matchAll(partRe)) {
      if (part[1] !== undefined) text += decodeXmlEntities(part[1]);
      else text += part[0].includes(":br") ? "\n" : "\t";
    }
    const line = text.replace(/[ \t]+\n/g, "\n").trim();
    if (line) result.push(line);
  }
  return result;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function slideNumber(name: string): number | null {
  const match = /^ppt\/slides\/slide([0-9]+)\.xml$/.exec(name);
  return match ? Number(match[1]) : null;
}

function cap(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_EXTRACT_CHARS) return { text: clean, truncated: false };
  return { text: `${clean.slice(0, MAX_EXTRACT_CHARS).trimEnd()}\n[…текст обрезан]`, truncated: true };
}

// ---------- pptx / docx ----------

export function extractPptx(bytes: Uint8Array): ExtractResult {
  let entries: ZipEntry[];
  try {
    entries = readZip(bytes);
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const slides = entries
    .map((entry) => ({ entry, n: slideNumber(entry.name) }))
    .filter((item): item is { entry: ZipEntry; n: number } => item.n !== null)
    .sort((a, b) => a.n - b.n);
  if (slides.length === 0) return { ok: false, error: "unreadable" };
  const chunks: string[] = [];
  try {
    for (const { entry, n } of slides) {
      const lines = paragraphs(decoder.decode(entry.read()), "a");
      chunks.push(`Слайд ${n}:\n${lines.length ? lines.join("\n") : "(без текста)"}`);
    }
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const { text, truncated } = cap(chunks.join("\n\n"));
  return { ok: true, content: { text, slides: slides.length, pages: null, truncated } };
}

export function extractDocx(bytes: Uint8Array): ExtractResult {
  let xml: string;
  try {
    const document = readZip(bytes).find((entry) => entry.name === "word/document.xml");
    if (!document) return { ok: false, error: "unreadable" };
    xml = decoder.decode(document.read());
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const lines = paragraphs(xml, "w");
  if (lines.length === 0) return { ok: false, error: "empty" };
  const { text, truncated } = cap(lines.join("\n"));
  return { ok: true, content: { text, slides: null, pages: null, truncated } };
}

// ---------- pdf ----------

export async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text: pages } = await extractText(document, { mergePages: false });
    const joined = pages.map((page, i) => `Страница ${i + 1}:\n${page.trim() || "(без текста)"}`).join("\n\n");
    if (!pages.some((page) => page.trim())) return { ok: false, error: "empty" };
    const { text, truncated } = cap(joined);
    return { ok: true, content: { text, slides: null, pages: totalPages, truncated } };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

// ---------- общий вход ----------

export function extractPlainText(bytes: Uint8Array): ExtractResult {
  const raw = decoder.decode(bytes).replace(/\u0000/g, "");
  if (!raw.trim()) return { ok: false, error: "empty" };
  const { text, truncated } = cap(raw);
  return { ok: true, content: { text, slides: null, pages: null, truncated } };
}

/** Текст работы по расширению файла. null — такой формат модель не читает (картинка, видео, звук). */
export async function extractHomeworkText(bytes: Uint8Array, ext: HomeworkExt): Promise<ExtractResult | null> {
  switch (ext) {
    case "pptx":
      return extractPptx(bytes);
    case "docx":
      return extractDocx(bytes);
    case "pdf":
      return extractPdf(bytes);
    case "txt":
    case "md":
      return extractPlainText(bytes);
    default:
      return null;
  }
}
