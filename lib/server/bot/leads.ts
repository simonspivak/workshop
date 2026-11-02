import "server-only";
import { normalizeKey, type LeadForm } from "@/lib/server/bot/tools";

/*
  Служебные строки в ответе модели (docs/platform/spec.md §5):
    [[ЗАЯВКА]]{json}    — гость подтвердил заявку;
    [[ОТКРЫТКА]]{json}  — гость согласился на открытку (цену и кнопку покажет платформа).
  Сервер вырезает их из ответа всегда, даже если инструмент выключен: гость их не видит.
  Бот заявки только пишет: прочитать таблицу он не может (её в промпт не передаём).
*/

export const LEAD_MARKER = "[[ЗАЯВКА]]";
export const CARD_MARKER = "[[ОТКРЫТКА]]";

// [[ЗАЯВКА]], [[ заявка ]], [[ЗАЯВКА]]: — модель иногда добавляет пробелы и двоеточие
const MARKER_RE = /\[\[\s*(ЗАЯВКА|ОТКРЫТКА|ZAYAVKA|LEAD|CARD)\s*\]\]\s*:?/giu;

export type ServiceLines = {
  /** ответ без служебных строк */
  text: string;
  /** JSON первой заявки; undefined — заявки не было, null — маркер без валидного JSON */
  lead: unknown;
  card: unknown;
};

/** Найти и вырезать служебные строки. Берётся первая заявка и первая открытка. */
export function extractServiceLines(raw: string): ServiceLines {
  let text = raw;
  let lead: unknown = undefined;
  let card: unknown = undefined;

  for (let guard = 0; guard < 10; guard++) {
    MARKER_RE.lastIndex = 0;
    const match = MARKER_RE.exec(text);
    if (!match) break;
    const kind = match[1].toUpperCase();
    const isLead = kind === "ЗАЯВКА" || kind === "ZAYAVKA" || kind === "LEAD";

    let cursor = match.index + match[0].length;
    // необязательный блок кода ```json … ```
    const fence = /^\s*```(?:json)?\s*/i.exec(text.slice(cursor));
    if (fence) cursor += fence[0].length;
    while (cursor < text.length && /\s/.test(text[cursor]) && text[cursor] !== "\n") cursor++;

    let end = cursor;
    let value: unknown = null;
    if (text[cursor] === "{") {
      const close = findJsonObjectEnd(text, cursor);
      if (close !== -1) {
        try {
          value = JSON.parse(text.slice(cursor, close + 1));
        } catch {
          value = null;
        }
        end = close + 1;
        const closingFence = /^\s*```/.exec(text.slice(end));
        if (fence && closingFence) end += closingFence[0].length;
      } else {
        // JSON оборван: вырезаем до конца строки
        const newline = text.indexOf("\n", cursor);
        end = newline === -1 ? text.length : newline;
      }
    }

    if (isLead && lead === undefined) lead = value;
    if (!isLead && card === undefined) card = value;
    text = text.slice(0, match.index) + text.slice(end);
  }

  text = text
    .replace(/```\s*```/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, lead, card };
}

/** Индекс закрывающей скобки объекта JSON, который начинается в start, или -1. */
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length && i < start + 4000; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export type LeadData = Record<string, string | number>;

export type LeadValidation =
  | { ok: true; data: LeadData }
  | { ok: false; reason: "not_object" | "missing_field" | "bad_value" | "personal_data" | "empty" };

const TEXT_MAX = { name: 60, text: 200, contact: 100, choice: 40 } as const;

/**
 * Проверить заявку от модели по полям формы владельца.
 * Ключи — подписи полей (регистр и пробелы не важны) или f1…f4. Лишние ключи отбрасываются.
 * Результат — объект «подпись поля → значение», так его видно в таблице и CSV даже после правки формы.
 * allowContact = false — поле «Контакт» не сохраняется (боты владельцев младше 18).
 * hasPersonalData — проверка ПДн для ботов младших: заявка с телефоном или e-mail отклоняется.
 */
export function validateLead(
  form: LeadForm,
  raw: unknown,
  options: { allowContact: boolean; hasPersonalData?: (value: string) => boolean },
): LeadValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not_object" };
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 20);
  const byKey = new Map<string, unknown>();
  for (const [key, value] of entries) byKey.set(normalizeKey(key), value);

  const data: LeadData = {};
  for (const [index, field] of form.fields.entries()) {
    if (field.type === "contact" && !options.allowContact) continue;
    const value = byKey.get(normalizeKey(field.label)) ?? byKey.get(`f${index + 1}`);
    const empty = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (empty) {
      if (field.required) return { ok: false, reason: "missing_field" };
      continue;
    }

    if (field.type === "number") {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 100_000) return { ok: false, reason: "bad_value" };
      data[field.label] = n;
      continue;
    }

    if (typeof value !== "string" && typeof value !== "number") return { ok: false, reason: "bad_value" };
    const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) {
      if (field.required) return { ok: false, reason: "missing_field" };
      continue;
    }

    if (field.type === "choice") {
      const chosen = field.options?.find((opt) => normalizeKey(opt) === normalizeKey(text));
      if (!chosen) return { ok: false, reason: "bad_value" };
      data[field.label] = chosen;
      continue;
    }

    const max = TEXT_MAX[field.type];
    if (text.length > max) return { ok: false, reason: "bad_value" };
    if (field.type !== "contact" && options.hasPersonalData?.(text)) return { ok: false, reason: "personal_data" };
    data[field.label] = text;
  }

  if (Object.keys(data).length === 0) return { ok: false, reason: "empty" };
  return { ok: true, data };
}

/** Сцена открытки от модели: { scene: "…" }, до 200 символов. */
export function readCardScene(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const scene = (raw as Record<string, unknown>).scene;
  if (typeof scene !== "string") return null;
  const text = scene.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length >= 3 && text.length <= 200 ? text : null;
}
