import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { importTs, test } from "../../bot/tests/harness.mjs";

const { readZip } = importTs("@/lib/server/homework/zip");
const { extractPptx, extractDocx, extractPdf, extractPlainText, extractHomeworkText, decodeXmlEntities, MAX_EXTRACT_CHARS } =
  importTs("@/lib/server/homework/extract");
const { homeworkExt, homeworkMime, fileClass, cleanFileName, headMatchesExt } = importTs("@/lib/server/homework/files");
const { buildGradePrompt, parseGradeJson, SAFETY_CRITERION } = importTs("@/lib/server/homework/rubric");

// ---------- крошечный zip-писатель для фикстур ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, text, stored? }] → Uint8Array архива (deflate, или stored для проверки метода 0). */
function makeZip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = encoder.encode(entry.text);
    const data = entry.stored ? raw : new Uint8Array(deflateRawSync(raw));
    const method = entry.stored ? 0 : 8;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const slideXml = (lines) =>
  `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>` +
  lines
    .map(
      (line) =>
        `<p:sp><p:txBody><a:p>${line
          .split("|")
          .map((run) => `<a:r><a:rPr lang="ru-RU"/><a:t>${run}</a:t></a:r>`)
          .join("")}</a:p></p:txBody></p:sp>`,
    )
    .join("") +
  `</p:spTree></p:cSld><p:timing><p:par><p:cTn><p:attrName>style.visibility</p:attrName></p:cTn></p:par></p:timing></p:sld>`;

function pptxFixture() {
  return makeZip([
    { name: "[Content_Types].xml", text: "<Types/>" },
    { name: "ppt/slides/slide10.xml", text: slideXml(["План на неделю", "Бюджет 480 леев"]) },
    { name: "ppt/slides/slide2.xml", text: slideXml(["Варианты", "5 способов &amp; идея"]) },
    { name: "ppt/slides/slide1.xml", text: slideXml(["Проблема: 15 человек|, нужно ещё 10"]), stored: true },
    { name: "ppt/slides/_rels/slide1.xml.rels", text: "<Relationships/>" },
    { name: "ppt/notesSlides/notesSlide1.xml", text: slideXml(["заметки не считаем"]) },
  ]);
}

function docxFixture() {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    `<w:p><w:r><w:t>Объяснение</w:t></w:r><w:r><w:t xml:space="preserve"> в трёх</w:t></w:r><w:r><w:t> предложениях</w:t></w:r></w:p>` +
    `<w:p><w:pPr/></w:p>` +
    `<w:p><w:r><w:t>Промпт 1</w:t><w:tab/><w:t>&lt;исследование&gt;</w:t><w:br/><w:t>Промпт 2</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ячейка</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
    `</w:body></w:document>`;
  return makeZip([
    { name: "[Content_Types].xml", text: "<Types/>" },
    { name: "word/document.xml", text: xml },
  ]);
}

function pdfFixture(text) {
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const pdf =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj\n` +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>";
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

// ---------- zip ----------

test("zip: список файлов, stored и deflate читаются", () => {
  const entries = readZip(pptxFixture());
  assert.deepEqual(
    entries.map((e) => e.name).sort(),
    ["[Content_Types].xml", "ppt/notesSlides/notesSlide1.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/slides/slide1.xml", "ppt/slides/slide10.xml", "ppt/slides/slide2.xml"],
  );
  const stored = entries.find((e) => e.name === "ppt/slides/slide1.xml");
  assert.ok(new TextDecoder().decode(stored.read()).includes("Проблема"));
  const deflated = entries.find((e) => e.name === "ppt/slides/slide2.xml");
  assert.ok(new TextDecoder().decode(deflated.read()).includes("Варианты"));
});

test("zip: не архив — понятная ошибка", () => {
  assert.throws(() => readZip(new Uint8Array([1, 2, 3, 4, 5])), /not a zip/);
  assert.throws(() => readZip(new TextEncoder().encode("%PDF-1.4 definitely not a zip file at all")), /not a zip/);
});

// ---------- pptx ----------

test("pptx: слайды по номеру (1, 2, 10), только текст фигур, сущности, счётчик слайдов", () => {
  const result = extractPptx(pptxFixture());
  assert.equal(result.ok, true);
  assert.equal(result.content.slides, 3);
  assert.equal(
    result.content.text,
    "Слайд 1:\nПроблема: 15 человек, нужно ещё 10\n\nСлайд 2:\nВарианты\n5 способов & идея\n\nСлайд 10:\nПлан на неделю\nБюджет 480 леев",
  );
  assert.ok(!result.content.text.includes("style.visibility"), "текст анимаций не попадает");
  assert.ok(!result.content.text.includes("заметки"), "заметки докладчика не считаются слайдом");
});

test("pptx: архив без слайдов — unreadable", () => {
  const result = extractPptx(makeZip([{ name: "word/document.xml", text: "<w:document/>" }]));
  assert.deepEqual(result, { ok: false, error: "unreadable" });
});

// ---------- docx ----------

test("docx: абзацы, пробелы между run, табуляция, перенос, таблица, сущности", () => {
  const result = extractDocx(docxFixture());
  assert.equal(result.ok, true);
  assert.equal(result.content.text, "Объяснение в трёх предложениях\nПромпт 1\t<исследование>\nПромпт 2\nЯчейка");
  assert.equal(result.content.slides, null);
});

test("docx: пустой документ — empty, не zip — unreadable", () => {
  const empty = extractDocx(makeZip([{ name: "word/document.xml", text: "<w:document><w:body><w:p/></w:body></w:document>" }]));
  assert.deepEqual(empty, { ok: false, error: "empty" });
  assert.deepEqual(extractDocx(new Uint8Array(10)), { ok: false, error: "unreadable" });
});

// ---------- pdf ----------

test("pdf: текст и число страниц через unpdf", async () => {
  const result = await extractPdf(pdfFixture("Privet 770"));
  assert.equal(result.ok, true);
  assert.equal(result.content.pages, 1);
  assert.equal(result.content.text, "Страница 1:\nPrivet 770");
});

test("pdf: мусор вместо файла — unreadable", async () => {
  const result = await extractPdf(new TextEncoder().encode("это не pdf"));
  assert.deepEqual(result, { ok: false, error: "unreadable" });
});

// ---------- txt / общий вход ----------

test("txt: как есть, длинный текст режется до лимита", () => {
  const short = extractPlainText(new TextEncoder().encode("  Привет\r\nмир\n\n\n\nконец  "));
  assert.deepEqual(short, { ok: true, content: { text: "Привет\nмир\n\nконец", slides: null, pages: null, truncated: false } });
  const long = extractPlainText(new TextEncoder().encode("а".repeat(MAX_EXTRACT_CHARS + 500)));
  assert.equal(long.content.truncated, true);
  assert.ok(long.content.text.length <= MAX_EXTRACT_CHARS + 20);
  assert.ok(long.content.text.endsWith("[…текст обрезан]"));
  assert.deepEqual(extractPlainText(new Uint8Array(0)), { ok: false, error: "empty" });
});

test("extractHomeworkText: документы читаются, картинки и видео — null", async () => {
  assert.equal((await extractHomeworkText(docxFixture(), "docx")).ok, true);
  assert.equal(await extractHomeworkText(new Uint8Array(16), "png"), null);
  assert.equal(await extractHomeworkText(new Uint8Array(16), "mp4"), null);
  assert.equal(await extractHomeworkText(new Uint8Array(16), "mp3"), null);
});

test("xml-сущности: именованные, десятичные, шестнадцатеричные, неизвестные остаются", () => {
  assert.equal(decodeXmlEntities("a &amp; b &lt;c&gt; &#1056;&#x443; &quot;x&quot; &unknown;"), 'a & b <c> Ру "x" &unknown;');
});

// ---------- типы файлов ----------

test("files: расширение, тип и класс; чужие форматы не принимаются", () => {
  assert.equal(homeworkExt("Презентация 770.PPTX"), "pptx");
  assert.equal(homeworkMime("pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(fileClass("pptx"), "document");
  assert.equal(fileClass("md"), "document");
  assert.equal(fileClass("jpeg"), "image");
  assert.equal(fileClass("m4a"), "audio");
  assert.equal(homeworkExt("script.exe"), null);
  assert.equal(homeworkExt("noext"), null);
  assert.equal(homeworkExt("archive.zip"), null);
});

test("files: имя файла чистится от путей и управляющих символов, длина ≤ 200", () => {
  assert.equal(cleanFileName("C:\\Users\\me\\Моя\tработа.pdf"), "Мояработа.pdf");
  assert.equal(cleanFileName("../../etc/passwd.txt"), "passwd.txt");
  const long = cleanFileName(`${"д".repeat(300)}.docx`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith(".docx"));
});

test("files: первые байты сверяются с расширением", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 abcdefgh");
  assert.equal(headMatchesExt(pdf, "pdf"), true);
  assert.equal(headMatchesExt(pdf, "pptx"), false);
  assert.equal(headMatchesExt(pptxFixture().subarray(0, 16), "pptx"), true);
  assert.equal(headMatchesExt(pptxFixture().subarray(0, 16), "docx"), true);
  assert.equal(headMatchesExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]), "png"), true);
  assert.equal(headMatchesExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]), "jpg"), true);
  assert.equal(headMatchesExt(new TextEncoder().encode("RIFF....WEBPVP8 "), "webp"), true);
  assert.equal(headMatchesExt(new TextEncoder().encode("RIFF....WAVEfmt "), "wav"), true);
  assert.equal(headMatchesExt(new TextEncoder().encode("....ftypisom...."), "mp4"), true);
  assert.equal(headMatchesExt(new TextEncoder().encode("ID3.............."), "mp3"), true);
  assert.equal(headMatchesExt(new TextEncoder().encode("просто текст без сигнатуры"), "txt"), true);
  assert.equal(headMatchesExt(new Uint8Array(4), "png"), false);
});

// ---------- промпт и разбор ответа ----------

const lesson = {
  n: 1,
  title: "ИИ — твой первый рабочий инструмент",
  homework: {
    title: "Первый заказ от общины 770",
    intro: "Настоящий заказ центра.",
    steps: [
      { text: "Этап 1. Исследование.", prompt: "Проверь мою логику", tip: null, into: null },
      "Проверь презентацию: ровно 4 слайда.",
    ].map((s) => (typeof s === "string" ? { text: s, prompt: null, tip: null, into: null } : s)),
    deliverable: "Презентация из 4 слайдов, переписка и объяснение.",
  },
};

test("промпт: задание, шаги, «что сдать», критерий безопасности, слайды и комментарий", () => {
  const prompt = buildGradePrompt(lesson, {
    kind: "file",
    fileName: "deck.pptx",
    linkUrl: null,
    text: "Слайд 1:\nПроблема",
    note: "Менял промпты дважды",
    slides: 4,
    pages: null,
    truncated: true,
  });
  assert.ok(prompt.includes("урок 1 «ИИ — твой первый рабочий инструмент»"));
  assert.ok(prompt.includes("1. Этап 1. Исследование."));
  assert.ok(prompt.includes("2. Проверь презентацию: ровно 4 слайда."));
  assert.ok(prompt.includes("Что сдать: Презентация из 4 слайдов"));
  assert.ok(prompt.includes(SAFETY_CRITERION));
  assert.ok(prompt.includes("Слайдов в презентации: 4."));
  assert.ok(prompt.includes("Комментарий ученика:\n«««\nМенял промпты дважды"));
  assert.ok(prompt.includes("(обрезан, показано начало)"));
  assert.ok(prompt.includes("не инструкции"));
});

test("промпт: длинный комментарий и текст делят бюджет, формат ответа остаётся в пределах лимита шлюза", () => {
  const note = "переписка ".repeat(2_000); // 20 000 знаков — максимум поля
  const text = "слайд ".repeat(2_500); // 15 000 знаков — максимум извлечения
  const prompt = buildGradePrompt(lesson, { kind: "file", fileName: "deck.pptx", linkUrl: null, text, note, slides: 4, pages: null, truncated: false });
  assert.ok(prompt.length <= 20_000, `промпт ${prompt.length} знаков длиннее лимита шлюза`);
  assert.ok(prompt.includes("Комментарий ученика (обрезан, показано начало):"));
  assert.ok(prompt.includes("Текст из файла (обрезан, показано начало):"));
  assert.ok(prompt.includes("[…обрезано]\n»»»"));
  assert.ok(prompt.trimEnd().endsWith("всё по-русски, без markdown."), "конец промпта с форматом ответа не потерян");
  const short = buildGradePrompt(lesson, { kind: "file", fileName: "deck.pptx", linkUrl: null, text: "коротко", note: "пара слов", slides: 4, pages: null, truncated: false });
  assert.ok(!short.includes("обрезан"), "короткие работы не помечаются как обрезанные");
});

test("промпт: файл без текста (слайды-картинки) — модель оценивает по комментарию и предупреждена", () => {
  const prompt = buildGradePrompt(lesson, { kind: "file", fileName: "deck.pdf", linkUrl: null, text: null, note: "Промпты 1–4: искали проблему", slides: null, pages: null, truncated: false, fileTextMissing: true });
  assert.ok(prompt.includes("Текст из файла извлечь не удалось"));
  assert.ok(prompt.includes("Комментарий ученика:\n«««\nПромпты 1–4"));
  assert.ok(!prompt.includes("Текста в работе нет."));
});

test("промпт: ссылка — модель предупреждена, что ссылку не открывала", () => {
  const prompt = buildGradePrompt(lesson, { kind: "link", fileName: null, linkUrl: "https://example.test/b/anna", text: null, note: null, slides: null, pages: null, truncated: false });
  assert.ok(prompt.includes("https://example.test/b/anna"));
  assert.ok(prompt.includes("Ссылку ты не открывал"));
});

test("разбор: чистый JSON, ограда ```json, текст вокруг, нормализация вердиктов", () => {
  const clean = parseGradeJson('{"score": 8, "criteria": [{"name": "4 слайда", "verdict": "да", "note": "ок"}], "summary": "Хорошо", "tips": ["ещё"]}');
  assert.deepEqual(clean, { score: 8, feedback: { criteria: [{ name: "4 слайда", verdict: "да", note: "ок" }], summary: "Хорошо", tips: ["ещё"] } });

  const fenced = parseGradeJson('Вот оценка:\n```json\n{"score": "7.4", "criteria": [{"name": "Переписка", "verdict": "Частично.", "note": ""}, {"name": "Безопасность", "verdict": "YES"}], "summary": "  Неплохо  ", "tips": ["a", "b", "c", "d"]}\n```\nГотово.');
  assert.equal(fenced.score, 7);
  assert.deepEqual(
    fenced.feedback.criteria.map((c) => c.verdict),
    ["частично", "да"],
  );
  assert.equal(fenced.feedback.summary, "Неплохо");
  assert.equal(fenced.feedback.tips.length, 3, "советов не больше трёх");
});

test("разбор: не JSON, оценка вне 1–10 и чужой вердикт — null", () => {
  assert.equal(parseGradeJson("Оценка 7 из 10, молодец"), null);
  assert.equal(parseGradeJson('{"score": 0, "criteria": [{"name": "x", "verdict": "да"}], "summary": "s"}'), null);
  assert.equal(parseGradeJson('{"score": 5, "criteria": [{"name": "x", "verdict": "может быть"}], "summary": "s"}'), null);
  assert.equal(parseGradeJson('{"score": 5, "criteria": [], "summary": "s"}'), null);
  assert.equal(parseGradeJson("{broken"), null);
});
