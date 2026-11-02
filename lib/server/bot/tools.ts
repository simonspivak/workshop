import "server-only";
import { z } from "zod";

/*
  Инструменты бота — колонка bots.tools (jsonb, ≤ 2048 байт по check в миграции):
    { leads, image, knowledge, leadForm: { title, fields[] } | null }
  «Заявки» — форма из полей, которые выбрал владелец (docs/course/lesson-3.md §8.3):
  имя или ник, число, выбор из вариантов, короткий текст до 200 знаков и «Контакт».
  «Контакт» — только у взрослых владельцев и у ведущих (§14.4): у ботов 14–17 контактов нет.
*/

export const LEAD_FIELD_TYPES = ["name", "number", "choice", "text", "contact"] as const;
export type LeadFieldType = (typeof LEAD_FIELD_TYPES)[number];

export const LEAD_FORM_LIMITS = {
  fieldsMax: 4,
  titleMax: 60,
  labelMax: 40,
  optionsMax: 5,
  optionMax: 20,
  /** запас до 2048 байт jsonb (кириллица — 2 байта на символ, jsonb добавляет пробелы) */
  toolsBytesMax: 1700,
} as const;

/** Подсказка для модели: что ждём в поле. */
export const LEAD_FIELD_HINTS: Record<LeadFieldType, string> = {
  name: "имя или ник",
  number: "целое число",
  choice: "один вариант из списка",
  text: "короткий текст до 200 знаков",
  contact: "телефон, e-mail или ник в Telegram",
};

const label = z.string().trim().min(1).max(LEAD_FORM_LIMITS.labelMax);
const option = z.string().trim().min(1).max(LEAD_FORM_LIMITS.optionMax);

export const leadFieldSchema = z
  .object({
    label,
    type: z.enum(LEAD_FIELD_TYPES),
    required: z.boolean().default(true),
    options: z.array(option).max(LEAD_FORM_LIMITS.optionsMax).optional(),
  })
  .transform((field) => ({
    label: field.label.replace(/\s+/g, " "),
    type: field.type,
    required: field.required,
    // варианты нужны только полю «выбор»
    ...(field.type === "choice" ? { options: dedupe(field.options ?? []) } : {}),
  }))
  .refine((field) => field.type !== "choice" || (field.options?.length ?? 0) >= 2, {
    message: "У поля «выбор» нужно минимум два варианта.",
    path: ["options"],
  });

export const leadFormSchema = z
  .object({
    title: z.string().trim().min(1).max(LEAD_FORM_LIMITS.titleMax),
    fields: z.array(leadFieldSchema).min(1).max(LEAD_FORM_LIMITS.fieldsMax),
  })
  .refine((form) => new Set(form.fields.map((f) => normalizeKey(f.label))).size === form.fields.length, {
    message: "Названия полей не должны повторяться.",
    path: ["fields"],
  });

export type LeadField = z.infer<typeof leadFieldSchema>;
export type LeadForm = z.infer<typeof leadFormSchema>;

export type BotTools = { leads: boolean; image: boolean; knowledge: boolean; leadForm: LeadForm | null };

export const DEFAULT_TOOLS: BotTools = { leads: false, image: false, knowledge: false, leadForm: null };

const storedToolsSchema = z.object({
  leads: z.boolean().catch(false),
  image: z.boolean().catch(false),
  knowledge: z.boolean().catch(false),
  leadForm: leadFormSchema.nullable().catch(null).default(null),
});

/** Прочитать bots.tools из базы. Битые и старые значения превращаются в «выключено». */
export function readTools(value: unknown): BotTools {
  const parsed = storedToolsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_TOOLS;
}

export type ToolsProblem = "contact_adult_only" | "lead_form_required" | "tools_too_large";

/**
 * Правила, которые зависят от владельца: «Контакт» — только 18+ и ведущим;
 * включённые «Заявки» без формы не работают; jsonb не больше лимита.
 */
export function checkToolsForOwner(tools: BotTools, owner: { allowContact: boolean }): ToolsProblem | null {
  if (!owner.allowContact && tools.leadForm?.fields.some((f) => f.type === "contact")) return "contact_adult_only";
  if (tools.leads && !tools.leadForm) return "lead_form_required";
  if (Buffer.byteLength(JSON.stringify(tools), "utf8") > LEAD_FORM_LIMITS.toolsBytesMax) return "tools_too_large";
  return null;
}

/** Ключ для сравнения подписей полей: регистр, пробелы, ё/е, кавычки не важны. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'«»„“”`]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((v) => v.replace(/\s+/g, " "))) {
    const key = normalizeKey(value);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}
