import "server-only";

/*
  Модерация текста до отправки в модели (docs/platform/spec.md §3, шаг 2).
  Два слоя без LLM: стоп-слова и персональные данные (телефоны, e-mail, адреса, номера карт).
  Возвращает только код причины — совпавшее слово наружу не отдаём.
  Отказ модерации пишется в audit_log (action 'moderation.blocked') вызывающим кодом.
*/

export type ModerationReason = "stop_word" | "phone" | "email" | "address" | "card" | "too_long";

export type ModerationResult = { ok: true } | { ok: false; reason: ModerationReason; field?: string };

// Корни: совпадение с начала слова. Целые слова: только точное совпадение (чтобы «жидкость» не ловилась).
const STOP_STEMS = [
  // мат и оскорбления
  "хуй", "хуе", "хуё", "хуя", "пизд", "ебан", "ебат", "ебал", "ебун", "ёбан", "заеб", "уеб", "выеб", "въеб",
  "бляд", "блят", "мудак", "мудил", "залуп", "пидор", "пидар", "шлюх", "гандон",
  "fuck", "motherfuck", "cunt", "nigger", "nigga", "faggot", "retard",
  // сексуальный контент
  "порн", "porn", "хентай", "hentai", "эрот", "erotic", "nsfw", "onlyfans", "стриптиз", "минет",
  "оргазм", "мастурб", "masturb", "изнасил", "насилова", "rape", "педофил", "pedophil", "лоли", "loli",
  "обнажён", "обнажен", "голая", "голые", "голого", "naked", "nude", "topless", "сиськ", "titty", "boobs",
  // насилие и жестокость
  "расчлен", "обезглав", "behead", "decapitat", "gore", "кровищ", "расстрел", "school shoot", "теракт",
  "terrorist",
  // наркотики
  "кокаин", "cocaine", "героин", "heroin", "метамфетамин", "methamphetamine", "мефедрон", "амфетамин",
  "amphetamine", "наркот", "спайс",
  // оружие и взрывчатка
  "взрывчат", "explosive", "сделать бомбу", "make a bomb", "собрать бомбу",
  // самоповреждение
  "суицид", "suicid", "самоубий", "покончить с собой", "kill myself", "убить себя", "порезать вены",
  // ненависть
  "нацис", "nazi", "гитлер", "hitler", "свастик", "swastik", "swastika", "зиг хайль", "sieg heil", "kike",
];
const STOP_WORDS = [
  "жид", "жиды", "жидов", "жидовка", "жидовский", "сука", "суки", "сучка", "педик", "педики", "педиков",
  "cum", "sex", "секс", "xxx", "porno",
];

const LETTER = "\\p{L}\\p{N}";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const STOP_RE = new RegExp(
  `(?<![${LETTER}])(?:${STOP_STEMS.map(escape).join("|")})|(?<![${LETTER}])(?:${STOP_WORDS.map(escape).join("|")})(?![${LETTER}])`,
  "iu",
);

// Латинские буквы, похожие на кириллицу: «пиздa» с латинской a тоже ловится
const LOOKALIKES: Record<string, string> = {
  a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к", m: "м", t: "т", h: "н", b: "в",
};

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‏⁠﻿­]/g, "") // невидимые символы
    .replace(/ё/g, "е");
}

function cyrillicize(text: string): string {
  // только в словах, где уже есть кириллица
  return text.replace(/[\p{L}]+/gu, (word) =>
    /[а-я]/.test(word) ? [...word].map((ch) => LOOKALIKES[ch] ?? ch).join("") : word,
  );
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;
// кандидаты: цифры с пробелами, дефисами и скобками; потом считаем цифры
const DIGIT_RUN_RE = /(?<![\p{L}\p{N}])\+?\d[\d\s()-]{6,24}\d(?![\p{L}\p{N}])/gu;

const ADDRESS_RES = [
  // ул. Ленина 5 · улица Пушкина, дом 10 · пр-т Мира 12 · str. Ștefan cel Mare 1 · Strada Independenței 4
  /(?<![\p{L}])(?:ул\.?|улиц[аеуы]|просп\.?|проспект[аеу]?|пр-т|переул(?:ок|ке)|пер\.|бульвар[аеу]?|б-р|шоссе|наб\.|набережн\p{L}*|площад[ьи]|str\.|strada|bd\.|bulevardul|calea|street|avenue|vulytsya|вул\.?|вулиц[яі])\s+\p{L}[\p{L}\p{N}.'’ -]{1,40}?,?\s*(?:д\.?|дом|№|nr\.?)?\s*\d{1,4}(?![\p{N}])/iu,
  // кв. 12 · квартира 5 · apt 3
  /(?<![\p{L}])(?:кв\.?|квартир[аеуы]|apt\.?|apartment)\s*№?\s*\d{1,4}(?![\p{N}])/iu,
  // Musterstraße 5 · Hauptstr. 12
  /\p{L}{3,}(?:straße|strasse|str\.)\s*\d{1,4}/iu,
  // 221 Baker Street
  /(?<![\p{N}])\d{1,5}\s+\p{L}{3,}\s+(?:street|st\.|avenue|ave\.|road|rd\.)(?![\p{L}])/iu,
  // почтовый индекс Молдовы: MD-2001
  /(?<![\p{L}\p{N}])md-?\d{4}(?![\p{N}])/iu,
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function findPersonalData(text: string): ModerationReason | null {
  if (EMAIL_RE.test(text)) return "email";
  for (const match of text.matchAll(DIGIT_RUN_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return "card";
    if (digits.length >= 9 && digits.length <= 15) return "phone";
  }
  if (ADDRESS_RES.some((re) => re.test(text))) return "address";
  return null;
}

/**
 * Проверить текст. maxLength — общий лимит длины (по умолчанию 5000 символов).
 * Пустой текст проходит: обязательность полей проверяет zod.
 */
export function moderateText(text: string | null | undefined, options: { maxLength?: number } = {}): ModerationResult {
  if (!text) return { ok: true };
  if (text.length > (options.maxLength ?? 5000)) return { ok: false, reason: "too_long" };
  const normalized = normalize(text);
  if (STOP_RE.test(normalized) || STOP_RE.test(cyrillicize(normalized))) return { ok: false, reason: "stop_word" };
  const pii = findPersonalData(normalized);
  if (pii) return { ok: false, reason: pii };
  return { ok: true };
}

/** Проверить несколько полей запроса (prompt, text, lyrics, title…). Возвращает первую проблему. */
export function moderateFields(
  fields: Record<string, string | null | undefined>,
  options: { maxLength?: number } = {},
): ModerationResult {
  for (const [field, value] of Object.entries(fields)) {
    const result = moderateText(value, options);
    if (!result.ok) return { ...result, field };
  }
  return { ok: true };
}
