import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { studentEmailDomain } from "@/lib/server/env";

/*
  Логины и пароли учеников.
  Логин: <код группы>-<ник латиницей>, например md1-lisa. В Supabase Auth это технический
  адрес md1-lisa@<STUDENT_EMAIL_DOMAIN>. Писем туда не бывает.
*/

export const LOGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const GROUP_CODE_RE = /^[a-z0-9]{2,12}$/;

/** Логин или e-mail из формы входа → адрес для Supabase Auth. null — если ввод не похож ни на то, ни на другое. */
export function loginToEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.includes("@")) {
    return z.email().safeParse(value).success ? value : null;
  }
  return LOGIN_RE.test(value) && value.includes("-") ? `${value}@${studentEmailDomain()}` : null;
}

export function studentEmail(login: string): string {
  return `${login}@${studentEmailDomain()}`;
}

const translit: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // украинский
  є: "ye", і: "i", ї: "yi", ґ: "g",
};

/** Ник → часть логина латиницей: «Лиза» → liza, «Анна-Мария» → anna-mariya. */
export function nicknameToLoginPart(nickname: string): string {
  const latin = [...nickname.toLowerCase()]
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, ""); // румынские и прочие диакритики: ș → s, ă → a
  const part = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return part || "user";
}

/**
 * Подбирает свободные логины для пачки ников. taken — уже занятые логины (из базы).
 * Совпадения получают цифру: md1-lisa, md1-lisa2, md1-lisa3.
 */
export function assignLogins(groupCode: string, nicknames: string[], taken: Iterable<string>): string[] {
  const used = new Set(taken);
  return nicknames.map((nickname) => {
    const base = `${groupCode}-${nicknameToLoginPart(nickname)}`;
    let login = base;
    for (let n = 2; used.has(login); n++) login = `${base}${n}`;
    used.add(login);
    return login;
  });
}

// Простые слова латиницей: их легко прочитать с карточки и набрать на телефоне
const WORDS = (
  "akula alfa angel arbuz arka astra avto bagel balet banan bant baza bekon belka bereg biser bober bolid " +
  "bonus borsch brokkoli bublik buran burya chaika chaynik chizh dino disk dolka domino dozhd drakon " +
  "dyatel dyna ekran elka enot fakel fanta feya finik flag forma foto galka gamak gitara globus golub gong " +
  "gora grecha grib grom gruzd gusli igla ikra iris kaktus kakao kamen kanoe kapli karta kasha kedr " +
  "kefir kino kiwi klen klyuch kofe komar kompas kosmos kot krab kran krem kub kukla kupol lama lampa laser " +
  "lava lebed lenta les lift limon lis lodka loto luch luna lyzhi mango mayak med meteor metro miks mishka " +
  "molniya more morkov motor muzyka myach nebo noga nota oblako ogon olen omar opal orbita orekh oskar ostrov " +
  "palma panda papka park parus pegas pelikan perets pianino pirog pixel planeta plov polet poni portal " +
  "pchela radar radio raketa rakushka reka robot roza rubin ryba sad sakura salat sapfir sardina selfi " +
  "signal sinitsa skala slon sneg sok sokol sova sputnik start stolb sup syr taiga tango teatr tigr " +
  "tort trava tsvet tuman tunets turbo udav ulei ural utka vafli valun vanil vesna veter vishnya " +
  "volna vulkan yagoda yakor yeti yozh zamok zarya zebra zefir zerno zhuk zima zont zvezda"
)
  .split(/\s+/)
  .filter((word) => /^[a-z]{4,9}$/.test(word));

/** Пароль из трёх слов и двух цифр: kiwi-raketa-sova-42. Показывается один раз. */
export function generatePassword(): string {
  const pick = () => WORDS[randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${pick()}-${String(randomInt(10, 100))}`;
}
