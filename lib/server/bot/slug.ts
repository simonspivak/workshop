import "server-only";

/*
  Адрес бота /b/<slug>: латиница, цифры и дефисы, 3–40 символов
  (то же правило, что check на bots.slug в миграции).
*/

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // украинский и румынский
  і: "i", ї: "yi", є: "ye", ґ: "g", ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t",
};

/** «Тётя Фира» → «tetya-fira». Всегда возвращает адрес, который проходит SLUG_RE. */
export function slugify(input: string): string {
  const latin = [...input.normalize("NFKC").toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  const base = latin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // диакритика: ü → u
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (base.length >= 3) return base;
  return base ? `${base}-bot` : "bot";
}

/** Привести адрес, который ввёл владелец. null — если из него ничего не выходит. */
export function normalizeSlug(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/^\/?b\//, "");
  if (!value) return null;
  const slug = slugify(value);
  return SLUG_RE.test(slug) ? slug : null;
}

/** Варианты, если адрес занят: base, base-2 … base-9. Длина не выходит за 40 символов. */
export function slugCandidates(base: string): string[] {
  const result = [base];
  for (let n = 2; n <= 9; n++) {
    const suffix = `-${n}`;
    result.push(`${base.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`);
  }
  return result.filter((slug) => SLUG_RE.test(slug));
}
