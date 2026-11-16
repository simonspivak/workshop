import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTs, importTsWith, test } from "../../bot/tests/harness.mjs";

/*
  Длинные работы (проверка по частям) и результаты из галереи в домашке.
  Тексты работ выдуманные. Шлюз и база подменены: настоящая модель и продакшен не вызываются.
*/

const passes = importTs("@/lib/server/homework/passes");
const rubric = importTs("@/lib/server/homework/rubric");
const rules = importTs("@/lib/server/homework/attachment-rules");
const { moderateText } = importTs("@/lib/server/moderation");
const { MAX_HOMEWORK_TEXT, gradingProgressText } = importTs("@/lib/platform/homework-types");

const { splitIntoChunks, planPasses, gradingMaterial, parseNotes, resumeState, progressOf, honestSummary, buildNotesPrompt } = passes;
const { CHUNK_CHARS, MAX_CHUNKS, NOTES_MAX_CHARS } = passes;
const { buildGradePrompt, buildGradePromptFromNotes, fitsOnePrompt, describeAttachments } = rubric;

// урок 1 из настоящего JSON: у него самое длинное задание (шаги ~2 900 знаков) — худший случай для длины промпта
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
function lessonFromJson(n) {
  const raw = JSON.parse(readFileSync(path.join(root, `docs/course/lesson-${n}.json`), "utf8"));
  const step = (s) => (typeof s === "string" ? { text: s, prompt: null, tip: null, into: null } : { text: s.text, prompt: s.prompt ?? null, tip: null, into: null });
  return {
    n,
    title: raw.title,
    homework: { title: raw.homework.title, intro: raw.homework.intro ?? null, steps: raw.homework.steps.map(step), deliverable: raw.homework.deliverable ?? null },
  };
}
const lesson1 = lessonFromJson(1);
const lesson2 = lessonFromJson(2);

const GATEWAY_LIMIT = 20_000;

/** Выдуманная переписка с ИИ: абзацы «Я: … / ИИ: …», нужной длины. */
function chatText(chars, seed = "") {
  const parts = [];
  let i = 0;
  let total = 0;
  while (total < chars) {
    const para = `Я (${seed}${i}): как сделать слайд про проблему понятнее для взрослых гостей?\nИИ: попробуй начать с одной цифры и короткого вывода, а потом дай пример из жизни центра.`;
    parts.push(para);
    total += para.length + 2;
    i++;
  }
  return parts.join("\n\n").slice(0, chars);
}

const work = (over) => ({ kind: "text", fileName: null, linkUrl: null, text: null, note: null, slides: null, pages: null, truncated: false, ...over });

// ---------- нарезка ----------

test("части: короткий текст — одна часть, склейка частей = исходный текст", () => {
  assert.deepEqual(splitIntoChunks("коротко"), ["коротко"]);
  assert.deepEqual(splitIntoChunks(""), [""]);
  const text = chatText(50_000);
  const chunks = splitIntoChunks(text);
  assert.equal(chunks.join(""), text, "ничего не потеряно и не задвоено");
  assert.ok(chunks.length >= 5 && chunks.length <= 6, `частей ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= CHUNK_CHARS, `часть ${c.length} > ${CHUNK_CHARS}`);
});

test("части: режется по абзацу, не посреди слова", () => {
  const text = chatText(40_000);
  const chunks = splitIntoChunks(text);
  for (const c of chunks.slice(0, -1)) {
    assert.ok(c.endsWith("\n\n"), `часть кончается не на границе абзаца: «${c.slice(-30)}»`);
  }
  // без пустых строк — по переносу; без переносов — по пробелу; слово не рвётся
  const lines = Array.from({ length: 3000 }, (_, i) => `строка номер ${i} про задание`).join("\n");
  for (const c of splitIntoChunks(lines).slice(0, -1)) assert.ok(c.endsWith("\n"));
  const words = Array.from({ length: 6000 }, (_, i) => `слово${i}`).join(" ");
  const wordChunks = splitIntoChunks(words);
  assert.equal(wordChunks.join(""), words);
  for (let i = 0; i < wordChunks.length - 1; i++) {
    assert.ok(/\s$/.test(wordChunks[i]) || /^\s/.test(wordChunks[i + 1]), "граница частей — пробел, а не середина слова");
  }
  // одно «слово» длиннее части — режется жёстко (другого выхода нет), но ничего не теряется
  const blob = "ж".repeat(30_000);
  const blobChunks = splitIntoChunks(blob);
  assert.deepEqual(blobChunks.map((c) => c.length), [12_000, 12_000, 6_000]);
});

test("части: не больше 10 (≈120 000 знаков), остальное считается в «всего»", () => {
  const plan = planPasses(chatText(150_000));
  assert.equal(plan.chunks.length, MAX_CHUNKS);
  assert.ok(plan.all > MAX_CHUNKS, `всего частей ${plan.all}`);
  assert.equal(plan.chars, 150_000);
  assert.ok(plan.chunks.join("").length >= 110_000 && plan.chunks.join("").length <= 120_000);
});

test("материал: комментарий и текст файла подписаны; файл без текста — только комментарий", () => {
  const m = gradingMaterial(work({ kind: "file", note: "переписка", text: "слайды" }));
  assert.equal(m, "[Комментарий ученика]\nпереписка\n\n[Текст из файла]\nслайды");
  assert.equal(gradingMaterial(work({ kind: "file", note: "только комментарий", text: "x", fileTextMissing: true })), "только комментарий");
  assert.equal(gradingMaterial(work({ text: "просто текст" })), "просто текст");
});

// ---------- заметки ----------

test("заметки: JSON → компактный текст ≤ 900 знаков, безопасность остаётся последней строкой", () => {
  const notes = parseNotes(
    '```json\n{"found": [{"part": "Переписка с ИИ", "quote": "как сделать слайд про проблему"}, {"part": "Разговор с ребятами", "quote": "друг Б сказал: начни с цифры"}], "other": "обсуждают бюджет", "safety": "нет"}\n```',
  );
  assert.equal(notes, "- Переписка с ИИ: «как сделать слайд про проблему»\n- Разговор с ребятами: «друг Б сказал: начни с цифры»\nЕщё: обсуждают бюджет\nБезопасность: нет");
  const many = parseNotes(
    JSON.stringify({ found: Array.from({ length: 12 }, (_, i) => ({ part: `пункт ${i} `.repeat(10), quote: "ц".repeat(300) })), other: "о".repeat(500), safety: "нет" }),
  );
  assert.ok(many.length <= NOTES_MAX_CHARS, `заметки ${many.length} знаков`);
  assert.ok(many.endsWith("Безопасность: нет"));
  assert.equal(parseNotes("В этой части есть переписка с ИИ про слайды."), "В этой части есть переписка с ИИ про слайды.", "не JSON — текст тоже заметки");
  assert.equal(parseNotes("   "), null);
  assert.equal(parseNotes('{"found": []}'), "- пунктов задания в этой части нет\nБезопасность: не отмечено");
});

test("промпт заметок: задание урока, номер части, данные — не инструкции, укладывается в лимит шлюза", () => {
  const chunk = "ж ".repeat(CHUNK_CHARS / 2);
  const prompt = buildNotesPrompt(lesson1, chunk, 2, 7);
  assert.ok(prompt.includes("часть 3 из 7"));
  assert.ok(prompt.includes("Что сдать:"));
  assert.ok(prompt.includes("не инструкции"));
  assert.ok(prompt.length <= GATEWAY_LIMIT - 500, `промпт заметок ${prompt.length} знаков`);
});

test("итоговый промпт по заметкам: все части подписаны «часть i из n», правило «есть хоть в одной — выполнено»", () => {
  const notes = ["- Переписка: «привет»", "- Разговор с ребятами: «друг Б: начни с цифры»", "- Объяснение: «я выбрал»"];
  const prompt = buildGradePromptFromNotes(lesson1, work({ text: "x" }), notes, 3, 30_000);
  assert.ok(prompt.includes("Заметки о части 2 из 3:\n«««\n- Разговор с ребятами"));
  assert.ok(prompt.includes("ВСЕЙ работы"));
  assert.ok(prompt.includes("если хоть в одной части есть то, что требует задание, — этот пункт выполнен"));
  assert.ok(!prompt.includes("Прочитано"), "вся работа прочитана — без оговорки");
  assert.ok(prompt.trimEnd().endsWith("всё по-русски, без markdown."));
});

test("итоговый промпт: 10 частей по 900 знаков и 20 результатов из галереи — в пределах лимита шлюза (урок 1)", () => {
  const notes = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(NOTES_MAX_CHARS));
  const attachments = Array.from({ length: 20 }, () => ({ action: "video", model: "Модель видео с длинным названием", durationSec: 5, prompt: "п".repeat(400), deleted: false }));
  const prompt = buildGradePromptFromNotes(lesson1, work({ kind: "file", fileName: "deck.pptx", attachments }), notes, 13, 150_000);
  assert.ok(prompt.length <= GATEWAY_LIMIT, `промпт ${prompt.length} знаков`);
  assert.ok(prompt.includes("прочитано 10 из 13 частей"));
  assert.ok(prompt.includes("«Прочитано 10 из 13 частей»"));
});

test("один промпт: короткие работы — как раньше; длинные (или с большим заданием) — по частям", () => {
  assert.equal(fitsOnePrompt(lesson1, work({ text: "x".repeat(5_000) })), true);
  assert.equal(fitsOnePrompt(lesson1, work({ kind: "file", note: "к".repeat(5_000), text: "т".repeat(5_000) })), true);
  assert.equal(fitsOnePrompt(lesson1, work({ kind: "file", note: "к".repeat(9_000), text: "т".repeat(100) })), false, "комментарий больше 8 000 раньше обрезался");
  assert.equal(fitsOnePrompt(lesson1, work({ text: "т".repeat(25_000) })), false);
  assert.equal(fitsOnePrompt(lesson1, work({ kind: "file", text: "т".repeat(100), truncated: true })), false);
  // всё, что «помещается», действительно помещается в лимит шлюза — даже у урока 1 с 20 результатами
  const attachments = Array.from({ length: 20 }, () => ({ action: "video", model: "m", durationSec: 5, prompt: "п".repeat(400), deleted: false }));
  const budget = rubric.workBudget(lesson1, work({ kind: "file", attachments }));
  const fit = work({ kind: "file", note: "к".repeat(Math.min(8_000, budget)), text: "т".repeat(budget - Math.min(8_000, budget)), attachments });
  assert.equal(fitsOnePrompt(lesson1, fit), true);
  const prompt = buildGradePrompt(lesson1, fit);
  assert.ok(prompt.length <= GATEWAY_LIMIT, `промпт ${prompt.length} знаков`);
  assert.ok(!prompt.includes("обрезан"), "помещающаяся работа не обрезается");
});

test("прогресс: продолжение с той же части; другой материал — заново; подпись «часть 3 из 7»", () => {
  const plan = { chunks: ["a", "b", "c"], all: 3, chars: 300 };
  const saved = { v: 1, chars: 300, total: 3, all: 3, notes: ["n1", "n2"], failures: 1 };
  assert.deepEqual(resumeState(saved, plan).notes, ["n1", "n2"]);
  assert.deepEqual(resumeState({ ...saved, chars: 301 }, plan).notes, [], "материал поменялся — начинаем заново");
  assert.deepEqual(resumeState(null, plan), { v: 1, chars: 300, total: 3, all: 3, notes: [], failures: 0 });
  assert.deepEqual(progressOf({ ...saved, total: 7, notes: ["1", "2"] }), { done: 2, total: 7 });
  assert.equal(progressOf(null), null);
  assert.equal(gradingProgressText({ done: 2, total: 7 }), "ИИ читает работу: часть 3 из 7");
  assert.equal(gradingProgressText({ done: 7, total: 7 }), "ИИ прочитал всю работу и ставит оценку…");
  assert.equal(gradingProgressText(null), "ИИ проверяет работу…");
});

test("честная выжимка: прочитано не всё — summary начинается с «Прочитано N из M частей»", () => {
  const grade = { score: 6, feedback: { criteria: [{ name: "x", verdict: "да", note: "" }], summary: "Хорошая работа.", tips: [] } };
  assert.equal(honestSummary(grade, 10, 10), grade);
  assert.ok(honestSummary(grade, 10, 13).feedback.summary.startsWith("Прочитано 10 из 13 частей"));
  const already = { ...grade, feedback: { ...grade.feedback, summary: "Прочитано 10 из 13 частей, но видно главное." } };
  assert.equal(honestSummary(already, 10, 13).feedback.summary, "Прочитано 10 из 13 частей, но видно главное.");
});

// ---------- результаты из галереи ----------

test("галерея в промпте: счёт по типам, модель, длина, промпт, честно «не видишь», удалённые не считаются", () => {
  const list = [
    ...Array.from({ length: 6 }, (_, i) => ({ action: "video", model: "Видео-модель", durationSec: 5, prompt: `Герой идёт по рынку, кадр ${i + 1}`, deleted: false })),
    { action: "image", model: "Картинки", durationSec: null, prompt: "Лист персонажа", deleted: false },
    { action: "motion", model: "Перенос", durationSec: null, prompt: null, deleted: false },
    { action: null, model: null, durationSec: null, prompt: null, deleted: true },
  ];
  const block = describeAttachments(list);
  assert.ok(block.startsWith("Результаты из галереи платформы, прикреплённые к сдаче: 8 (видео — 6, картинка — 1, видео (перенос движения) — 1); ещё 1 ученик удалил после сдачи"));
  assert.ok(block.includes("1. видео · Видео-модель · 5 с · промпт: «Герой идёт по рынку, кадр 1»"));
  assert.ok(block.includes("8. видео (перенос движения) · Перенос · длина неизвестна"));
  assert.ok(block.includes("9. результат удалён"));
  assert.ok(block.includes("НЕ видишь"));
  assert.ok(block.includes("Качество изображения и видео оценит ведущий"));
  const longPrompt = describeAttachments([{ action: "video", model: "m", durationSec: 10, prompt: "слово ".repeat(100), deleted: false }]);
  assert.ok(longPrompt.includes("10 с"));
  assert.ok(/«[^»]{1,100}»/.test(longPrompt), "промпт обрезан до 100 знаков");
  assert.equal(describeAttachments([]), null);

  const prompt = buildGradePrompt(lesson2, work({ text: null, attachments: list }));
  assert.ok(prompt.includes("Ученик сдал результаты из галереи без текста."));
  assert.ok(prompt.includes("видео — 6"));
  assert.ok(!prompt.includes("Текста в работе нет."));
});

const OWNER = "c0000000-0000-4000-8000-000000000001";
const job = (n, over = {}) => ({
  id: `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  user_id: OWNER,
  action: "video",
  status: "done",
  hidden: false,
  deleted_at: null,
  ...over,
});

test("проверка прикреплённого: только свои готовые неудалённые медиа, без повторов, не больше 20", () => {
  const rows = [job(1), job(2), job(3, { action: "music" }), job(4, { action: "montage" })];
  const ids = rows.map((r) => r.id);
  assert.deepEqual(rules.checkAttachmentRows(ids, rows, OWNER), { ok: true, ids });
  assert.deepEqual(rules.checkAttachmentRows([], [], OWNER), { ok: true, ids: [] });
  const bad = { ok: false, error: "bad_attachments" };
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { user_id: "c0000000-0000-4000-8000-000000000002" })], OWNER), bad, "чужой результат");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { status: "submitted" })], OWNER), bad, "не готов");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { status: "failed" })], OWNER), bad, "неудачный");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { deleted_at: "2026-11-16T10:00:00Z" })], OWNER), bad, "удалён");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { hidden: true })], OWNER), bad, "скрыт ведущим");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [job(5, { action: "text" })], OWNER), bad, "текстовый ответ — не медиа");
  assert.deepEqual(rules.checkAttachmentRows([job(5).id], [], OWNER), bad, "нет такой задачи");
  assert.deepEqual(rules.checkAttachmentRows([job(1).id, job(1).id], [job(1)], OWNER), bad, "повтор");
  assert.deepEqual(rules.checkAttachmentRows([job(1).id, job(1).id.toUpperCase()], [job(1)], OWNER), bad, "повтор в другом регистре");
  assert.deepEqual(rules.checkAttachmentRows(["не-uuid"], [], OWNER), bad);
  const many = Array.from({ length: 21 }, (_, i) => job(i + 1));
  assert.deepEqual(rules.checkAttachmentRows(many.map((r) => r.id), many, OWNER), bad, "больше 20");
  assert.equal(rules.checkAttachmentRows(many.slice(0, 20).map((r) => r.id), many, OWNER).ok, true, "ровно 20 можно");
});

test("прикреплённое: id из jsonb и длительность из params", () => {
  assert.deepEqual(rules.attachmentIds([job(1).id, 5, "x", job(1).id, job(2).id.toUpperCase()]), [job(1).id, job(2).id]);
  assert.deepEqual(rules.attachmentIds(null), []);
  assert.equal(rules.attachmentDuration("video", { duration: 5 }), 5);
  assert.equal(rules.attachmentDuration("montage", { durationSec: 31.5 }), 31.5);
  assert.equal(rules.attachmentDuration("image", { size: "1:1" }), null);
  assert.equal(rules.attachmentDuration("video", null), null);
  assert.equal(rules.attachmentDuration("video", { duration: -1 }), null);
});

// ---------- модерация длинного текста ----------

test("модерация: 100 000 знаков проходят и проверяются быстро, 100 001 — too_long", () => {
  const text = chatText(MAX_HOMEWORK_TEXT);
  const started = Date.now();
  assert.deepEqual(moderateText(text, { maxLength: MAX_HOMEWORK_TEXT }), { ok: true });
  assert.ok(Date.now() - started < 2_000, `модерация ${Date.now() - started} мс`);
  assert.deepEqual(moderateText(`${text}ж`, { maxLength: MAX_HOMEWORK_TEXT }), { ok: false, reason: "too_long" });
  // телефон в середине длинной переписки находится
  const withPhone = `${text.slice(0, 50_000)} звони +373 69 123 456 ${text.slice(50_000, 99_000)}`;
  assert.equal(moderateText(withPhone, { maxLength: MAX_HOMEWORK_TEXT }).reason, "phone");
});

// ---------- grade.ts целиком: база и шлюз подменены ----------

/** Мини-PostgREST над одной строкой в памяти: eq, in, is, or(is.null / lt), update, select, maybeSingle. */
function fakeDb(table) {
  const rows = table;
  function builder(name) {
    const state = { op: "select", patch: null, filters: [], wantRows: false };
    const matches = (row) =>
      state.filters.every((f) => {
        const v = row[f.col];
        if (f.kind === "eq") return v === f.value;
        if (f.kind === "in") return f.value.includes(v);
        if (f.kind === "is") return v === null;
        if (f.kind === "or") return f.alts.some((a) => (a.op === "is" ? row[a.col] === null : row[a.col] !== null && row[a.col] < a.value));
        return true;
      });
    const run = () => {
      const list = (rows[name] ?? []).filter(matches);
      if (state.op === "update") {
        for (const row of list) Object.assign(row, state.patch);
        return { data: state.wantRows ? list.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: list.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() {
        if (state.op === "update") state.wantRows = true;
        return b;
      },
      update(patch) {
        state.op = "update";
        state.patch = patch;
        return b;
      },
      eq(col, value) {
        state.filters.push({ kind: "eq", col, value });
        return b;
      },
      in(col, value) {
        state.filters.push({ kind: "in", col, value });
        return b;
      },
      is(col) {
        state.filters.push({ kind: "is", col });
        return b;
      },
      or(expr) {
        const alts = expr.split(",").map((part) => {
          const [col, op, ...rest] = part.split(".");
          return { col, op, value: rest.join(".") };
        });
        state.filters.push({ kind: "or", alts });
        return b;
      },
      returns: () => b,
      maybeSingle: async () => {
        const { data } = run();
        return { data: data?.[0] ?? null, error: null };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
  return { from: builder, storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not used" } }) }) } };
}

const SID = "d0000000-0000-4000-8000-000000000001";
const MIDDLE_FACT = "РАЗГОВОР С РЕБЯТАМИ: друг А сказал, что слайд с цифрой понятнее, друг Б предложил короче заголовок";

function submissionRow(over) {
  return {
    id: SID,
    user_id: OWNER,
    group_id: null,
    lesson_id: "lesson-1",
    kind: "text",
    text_body: null,
    link_url: null,
    storage_path: null,
    file_name: null,
    mime: null,
    size_bytes: null,
    status: "submitted",
    ai_score: null,
    ai_feedback: null,
    ai_model: null,
    ai_error: null,
    grading_started_at: null,
    graded_at: null,
    superseded_at: null,
    attachments: null,
    grading_progress: null,
    ...over,
  };
}

/**
 * grade.ts с подменами. callMs — сколько «длится» каждый вызов модели (часы подменены).
 * Фальшивая модель: на промпт заметок отвечает JSON, где цитата есть, только если факт в этой части;
 * на итоговый промпт — оценкой (и запоминает промпт).
 */
function loadGrade({ row, callMs, failNotes = 0, attachments = [] }) {
  const db = { homework_submissions: [row] };
  const calls = { notes: 0, final: 0, finalPrompts: [] };
  let clock = Date.parse("2026-11-16T10:00:00Z");
  const realNow = Date.now;
  let failuresLeft = failNotes;
  const gateway = {
    generateText: async ({ prompt }) => {
      clock += callMs;
      if (prompt.includes("ЧАСТЬ РАБОТЫ")) {
        calls.notes++;
        if (failuresLeft > 0) {
          failuresLeft--;
          return { ok: false, error: "mock: gateway down" };
        }
        const found = [{ part: "Переписка с ИИ", quote: "как сделать слайд про проблему" }];
        if (prompt.includes(MIDDLE_FACT)) found.push({ part: "Разговор с ребятами", quote: MIDDLE_FACT.slice(0, 110) });
        return { ok: true, text: JSON.stringify({ found, other: "", safety: "нет" }), model: "mock-text" };
      }
      calls.final++;
      calls.finalPrompts.push(prompt);
      return {
        ok: true,
        model: "mock-text",
        text: JSON.stringify({ score: 8, criteria: [{ name: "Разговор с ребятами", verdict: "да", note: "есть" }], summary: "Хорошо.", tips: ["a"] }),
      };
    },
  };
  const grade = importTsWith("@/lib/server/homework/grade", {
    "@/lib/server/supabase/admin": { createAdminClient: () => fakeDb(db) },
    "@/lib/server/gateway": gateway,
    "@/lib/server/audit": { audit: async () => undefined },
    "@/lib/server/course": { getLessonById: () => lesson1 },
    "@/lib/server/jobs": { MEDIA_BUCKET: "media" },
    "./attachments": {
      loadAttachments: async () => attachments,
      attachmentsForGrading: (views) => views.map((v) => ({ action: v.action, model: v.model, durationSec: v.durationSec, prompt: v.prompt, deleted: v.deleted })),
    },
  });
  /** Один «опрос»: вызов gradeSubmission при подменённых часах. */
  const poll = async () => {
    Date.now = () => clock;
    try {
      await grade.gradeSubmission(SID, { startedAt: clock });
    } finally {
      Date.now = realNow;
    }
    clock += 5_000; // браузер ждёт 5 с до следующего опроса
  };
  return { db, calls, poll, grade, row: () => db.homework_submissions[0] };
}

test("60 000 знаков: факт из СРЕДНЕЙ части доходит до итогового промпта; по одной части за опрос", async () => {
  const before = chatText(28_000, "a");
  const after = chatText(30_000, "b");
  const text = `${before}\n\n${MIDDLE_FACT}\n\n${after}`;
  assert.ok(text.length > 58_000 && text.length <= 60_000);
  const chunks = splitIntoChunks(text);
  const factChunk = chunks.findIndex((c) => c.includes(MIDDLE_FACT));
  assert.ok(factChunk > 0 && factChunk < chunks.length - 1, `факт в части ${factChunk + 1} из ${chunks.length} — не в первой и не в последней`);

  const t = loadGrade({ row: submissionRow({ text_body: text }), callMs: 30_000 });
  await t.poll();
  // вызов длился 30 с > 12 с: вторую часть этот запрос не начинает, прогресс сохранён, строка отпущена
  assert.equal(t.calls.notes, 1);
  assert.equal(t.row().status, "grading");
  assert.equal(t.row().grading_started_at, null, "строка отпущена — следующий опрос продолжит сразу");
  assert.equal(t.row().grading_progress.notes.length, 1);
  assert.deepEqual(progressOf(t.row().grading_progress), { done: 1, total: chunks.length });

  for (let i = 0; i < 20 && t.row().status !== "graded"; i++) await t.poll();
  assert.equal(t.row().status, "graded");
  assert.equal(t.calls.notes, chunks.length, "каждая часть прочитана ровно один раз");
  assert.equal(t.calls.final, 1);
  const finalPrompt = t.calls.finalPrompts[0];
  assert.ok(finalPrompt.includes(`Заметки о части ${factChunk + 1} из ${chunks.length}:`));
  assert.ok(finalPrompt.includes(MIDDLE_FACT.slice(0, 60)), "цитата из средней части есть в итоговом промпте");
  assert.ok(!finalPrompt.includes(before.slice(0, 200)), "сырого текста работы в итоговом промпте нет — только заметки");
  assert.ok(finalPrompt.length <= GATEWAY_LIMIT);
  assert.equal(t.row().ai_score, 8);
});

test("быстрые ответы модели: вся длинная работа проверяется за один запрос", async () => {
  const t = loadGrade({ row: submissionRow({ text_body: chatText(40_000) }), callMs: 2_000 });
  await t.poll();
  assert.equal(t.row().status, "graded");
  assert.equal(t.calls.notes, splitIntoChunks(chatText(40_000)).length);
  assert.equal(t.calls.final, 1);
});

test("захват: пока проверка идёт в другом запросе, второй опрос ничего не делает", async () => {
  const t = loadGrade({ row: submissionRow({ text_body: chatText(40_000), status: "grading", grading_started_at: "2026-11-16T09:59:30.000Z" }), callMs: 30_000 });
  await t.poll();
  assert.equal(t.calls.notes, 0, "захват свежий (30 с) — двойной работы нет");
  const stale = loadGrade({ row: submissionRow({ text_body: chatText(40_000), status: "grading", grading_started_at: "2026-11-16T09:58:00.000Z" }), callMs: 30_000 });
  await stale.poll();
  assert.equal(stale.calls.notes, 1, "захват старше 90 с — перехватывается");
});

test("больше 10 частей: читаются 10, оценка честно говорит «прочитано 10 из M»", async () => {
  const text = chatText(150_000); // как длинный документ из файла (у текста поля лимит 100 000)
  const all = splitIntoChunks(text).length;
  const t = loadGrade({ row: submissionRow({ text_body: text }), callMs: 1_000 });
  await t.poll();
  await t.poll();
  assert.equal(t.row().status, "graded");
  assert.equal(t.calls.notes, MAX_CHUNKS);
  assert.ok(t.calls.finalPrompts[0].includes(`прочитано ${MAX_CHUNKS} из ${all} частей`));
  assert.ok(t.row().ai_feedback.summary.startsWith(`Прочитано ${MAX_CHUNKS} из ${all} частей`), t.row().ai_feedback.summary);
});

test("короткая работа — один вызов, как раньше; результаты из галереи в промпте", async () => {
  const attachments = Array.from({ length: 6 }, (_, i) => ({
    jobId: job(i + 1).id,
    deleted: false,
    hidden: false,
    action: "video",
    kind: "video",
    model: "Видео-модель",
    prompt: `клип ${i + 1}`,
    durationSec: 5,
    url: null,
    createdAt: null,
  }));
  const t = loadGrade({ row: submissionRow({ text_body: "Идея монтажа: герой идёт через рынок", attachments: attachments.map((a) => a.jobId) }), callMs: 5_000, attachments });
  await t.poll();
  assert.equal(t.calls.notes, 0);
  assert.equal(t.calls.final, 1);
  assert.ok(t.calls.finalPrompts[0].includes("Текст работы:\n«««\nИдея монтажа"));
  assert.ok(t.calls.finalPrompts[0].includes("прикреплённые к сдаче: 6 (видео — 6)"));
  assert.ok(t.calls.finalPrompts[0].includes("1. видео · Видео-модель · 5 с · промпт: «клип 1»"));
  assert.equal(t.row().status, "graded");
});

test("сбой шлюза на заметках: повтор при следующем опросе, после 3 сбоев подряд — failed", async () => {
  const ok = loadGrade({ row: submissionRow({ text_body: chatText(30_000) }), callMs: 30_000, failNotes: 1 });
  await ok.poll();
  assert.equal(ok.row().status, "grading");
  assert.equal(ok.row().grading_progress.failures, 1);
  assert.equal(ok.row().grading_started_at, null);
  for (let i = 0; i < 10 && ok.row().status !== "graded"; i++) await ok.poll();
  assert.equal(ok.row().status, "graded", "после одного сбоя проверка доходит до конца");

  const bad = loadGrade({ row: submissionRow({ text_body: chatText(30_000) }), callMs: 30_000, failNotes: 5 });
  for (let i = 0; i < 6 && bad.row().status !== "failed"; i++) await bad.poll();
  assert.equal(bad.row().status, "failed");
  assert.equal(bad.row().ai_error, "gateway");
  assert.equal(bad.calls.notes, 3);
});

test("медиафайл без результатов из галереи — «оценит ведущий», с результатами — ИИ проверяет набор", () => {
  const { aiCanRead } = loadGrade({ row: submissionRow({}), callMs: 1 }).grade;
  assert.deepEqual(aiCanRead({ kind: "file", storage_path: "u/homework/x.mp4", size_bytes: 10 }), { ok: false, skip: "media" });
  assert.deepEqual(aiCanRead({ kind: "file", storage_path: "u/homework/x.mp4", size_bytes: 10, attachments: [job(1).id] }), { ok: true });
  assert.deepEqual(aiCanRead({ kind: "file", storage_path: "u/homework/x.pdf", size_bytes: 10 }), { ok: true });
});
