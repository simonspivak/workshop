#!/usr/bin/env node
// Проверка уроков docs/course/lesson-*.json: формат, читаемость, тест, модели и цены.
// Запуск: node scripts/check-lessons.mjs [docs/course/lesson-1.json ...]
// Без аргументов проверяет все уроки. Код выхода 1, если есть ошибки.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Модели и цены учеников из price_list (supabase/migrations/20261101200000_init.sql).
const MODELS = {
  // 1★ — «Ответ ИИ», 3★ — «Длинный ответ» (отдельный диалог)
  text: { "claude-haiku-5-5": [1, 3] },
  image: { "flux-3/klein-text-to-image": 2, "nano-banana-2-1": 5 },
  image_edit: { "flux-3/klein-edit-image": 2, "nano-banana-2-1": 5 },
  video: { "bytedance/seedance-2-mini": 25 },
  motion: { "kling-2.6/motion-control": 70 },
  lipsync: { "kling/ai-avatar-standard": 60 },
  voice: { "google/gemini-3-8-flash-tts": 2 },
  music: { "ai-music-api/generate": 15 },
  montage: { "platform/auto-montage": 0 },
};

const LIMITS = {
  stepText: 260,
  tip: 220,
  prompt: 2500,
  theoryBody: 900,
  theoryExample: 600,
  intro: 260,
  question: 220,
  option: 140,
  explanation: 320,
};

const BANNED = [/библи/i];

const dir = "docs/course";
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir)
      .filter((f) => /^lesson-\d+\.json$/.test(f))
      .map((f) => join(dir, f));

let errors = 0;
let warnings = 0;

for (const file of files) {
  const problems = [];
  const notes = [];
  const err = (m) => problems.push(m);
  const warn = (m) => notes.push(m);
  let lesson;
  try {
    lesson = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`✗ ${file}: не JSON (${e.message})`);
    errors++;
    continue;
  }

  const str = (v, path, max) => {
    if (typeof v !== "string" || !v.trim()) return err(`${path}: нужна непустая строка`);
    if (max && v.length > max) err(`${path}: ${v.length} знаков, максимум ${max}`);
    for (const re of BANNED) if (re.test(v)) err(`${path}: запрещённое слово (${re})`);
  };
  const optStr = (v, path, max) => v === undefined || str(v, path, max);

  const step = (s, path) => {
    if (typeof s === "string") return str(s, path, LIMITS.stepText);
    if (!s || typeof s !== "object") return err(`${path}: строка или {text, prompt?, tip?}`);
    const extra = Object.keys(s).filter((k) => !["text", "prompt", "tip"].includes(k));
    if (extra.length) err(`${path}: лишние поля ${extra.join(", ")}`);
    str(s.text, `${path}.text`, LIMITS.stepText);
    optStr(s.prompt, `${path}.prompt`, LIMITS.prompt);
    optStr(s.tip, `${path}.tip`, LIMITS.tip);
  };

  // Промпты в шагах нумеруются на экране по порядку: «Промпт 1», «Промпт 2»…
  // Шаг может ссылаться только на промпт, который уже показан (в этом шаге или раньше).
  const checkPromptRefs = (steps, path) => {
    let shown = 0;
    steps.forEach((s, j) => {
      if (s && typeof s === "object" && s.prompt) shown++;
      const text = typeof s === "string" ? s : `${s?.text ?? ""} ${s?.tip ?? ""}`;
      for (const m of text.matchAll(/промпт[а-я]*\s*(?:№\s*)?(\d+)/gi)) {
        const n = Number(m[1]);
        if (n < 1 || n > shown) err(`${path}.steps[${j}]: ссылка на «Промпт ${n}», а показано промптов: ${shown}`);
      }
    });
  };

  if (!/^lesson-\d{1,2}$/.test(lesson.id ?? "")) err("id: lesson-N");
  if (!Number.isInteger(lesson.order)) err("order: целое число");
  if (lesson.id !== `lesson-${lesson.order}`) err("id и order не совпадают");
  str(lesson.title, "title", 90);
  str(lesson.oneLiner, "oneLiner", 200);
  if (!(lesson.durationMin >= 45 && lesson.durationMin <= 90)) err("durationMin: 45–90");
  if (!Array.isArray(lesson.goals) || lesson.goals.length < 2 || lesson.goals.length > 5) err("goals: 2–5 пунктов");
  (lesson.goals ?? []).forEach((g, i) => str(g, `goals[${i}]`, 160));
  str(lesson.outcome, "outcome", 400);

  const minutes = (lesson.timeline ?? []).reduce((sum, t) => sum + (t.minutes ?? 0), 0);
  if (!lesson.timeline?.length) err("timeline: нужен план урока");
  else if (Math.abs(minutes - lesson.durationMin) > 5) err(`timeline: ${minutes} мин, а durationMin ${lesson.durationMin}`);
  (lesson.timeline ?? []).forEach((t, i) => {
    str(t.block, `timeline[${i}].block`, 120);
    if (typeof t.teacherNotes !== "string") err(`timeline[${i}].teacherNotes: строка`);
  });

  if (!lesson.theory?.length || lesson.theory.length > 7) err("theory: 1–7 карточек");
  (lesson.theory ?? []).forEach((t, i) => {
    str(t.heading, `theory[${i}].heading`, 80);
    str(t.body, `theory[${i}].body`, LIMITS.theoryBody);
    optStr(t.example, `theory[${i}].example`, LIMITS.theoryExample);
  });

  const taskIds = new Set();
  if (!lesson.tasks?.length || lesson.tasks.length > 6) err("tasks: 1–6 заданий");
  (lesson.tasks ?? []).forEach((t, i) => {
    const p = `tasks[${i}]`;
    if (!/^[a-z0-9-]{1,60}$/.test(t.id ?? "")) err(`${p}.id: a-z0-9-`);
    if (taskIds.has(t.id)) err(`${p}.id: повтор`);
    taskIds.add(t.id);
    str(t.title, `${p}.title`, 90);
    if (!["solo", "group"].includes(t.mode)) err(`${p}.mode: solo | group`);
    optStr(t.intro, `${p}.intro`, LIMITS.intro);
    if (!t.steps?.length) err(`${p}.steps: нужны шаги`);
    if ((t.steps ?? []).length > 10) err(`${p}.steps: больше 10 шагов — разбей задание`);
    (t.steps ?? []).forEach((s, j) => step(s, `${p}.steps[${j}]`));
    if (!Array.isArray(t.promptTemplates)) err(`${p}.promptTemplates: массив (можно пустой)`);
    (t.promptTemplates ?? []).forEach((s, j) => str(s, `${p}.promptTemplates[${j}]`, LIMITS.prompt));
    (t.aiActions ?? []).forEach((a, j) => {
      const prices = MODELS[a.type];
      if (!prices) return err(`${p}.aiActions[${j}].type: неизвестное действие ${a.type}`);
      if (!(a.model in prices)) return err(`${p}.aiActions[${j}].model: ${a.model} нет у учеников для ${a.type}`);
      const allowed = [prices[a.model]].flat();
      if (!allowed.includes(a.stars)) err(`${p}.aiActions[${j}].stars: ${a.stars}, в прайсе ${allowed.join(" или ")}`);
    });
    if ((t.aiActions ?? []).filter((a) => a.type === "text").length > 1)
      err(`${p}.aiActions: один чат на задание («Ответ ИИ» или «Длинный ответ»), иначе диалог разделится`);
    checkPromptRefs(t.steps ?? [], p);
    optStr(t.doneWhen, `${p}.doneWhen`, 260);
  });

  if (lesson.tools !== undefined) {
    if (!Array.isArray(lesson.tools)) err("tools: массив");
    (lesson.tools ?? []).forEach((t, i) => {
      str(t.name, `tools[${i}].name`, 60);
      if (!/^https:\/\/[^\s]+$/.test(t.url ?? "")) err(`tools[${i}].url: https-ссылка`);
      str(t.what, `tools[${i}].what`, 220);
      optStr(t.cost, `tools[${i}].cost`, 120);
      optStr(t.age, `tools[${i}].age`, 120);
    });
  }

  // Тест: 10 вопросов, 4 варианта, правильный ответ не выдаёт себя длиной и позицией.
  const quiz = lesson.quiz ?? [];
  if (quiz.length !== 10) err(`quiz: ${quiz.length} вопросов, нужно 10`);
  const positions = [0, 0, 0, 0];
  let longest = 0;
  quiz.forEach((q, i) => {
    const p = `quiz[${i}]`;
    str(q.question, `${p}.question`, LIMITS.question);
    if (!Array.isArray(q.options) || q.options.length !== 4) return err(`${p}.options: ровно 4 варианта`);
    q.options.forEach((o, j) => {
      str(o, `${p}.options[${j}]`, LIMITS.option);
      if (/все (ответы|варианты)|всё перечисленное|все перечисленные|ни один из/i.test(o))
        err(`${p}.options[${j}]: без «всё перечисленное / ни один из»`);
    });
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return err(`${p}.correctIndex: 0–3`);
    positions[q.correctIndex]++;
    str(q.explanation, `${p}.explanation`, LIMITS.explanation);
    const lens = q.options.map((o) => o.length);
    const correct = lens[q.correctIndex];
    const others = lens.filter((_, j) => j !== q.correctIndex);
    if (correct > Math.max(...others)) longest++;
    if (correct > 1.3 * Math.max(...others)) warn(`${p}: правильный ответ заметно длиннее остальных (${correct} vs ${Math.max(...others)})`);
  });
  if (quiz.length === 10) {
    if (longest > 3) err(`quiz: правильный ответ самый длинный в ${longest} из 10 вопросов (максимум 3)`);
    if (positions.some((n) => n < 1 || n > 4)) err(`quiz: позиции правильных ответов ${positions.join("/")} — каждая от 1 до 4 раз`);
  }

  const hw = lesson.homework;
  if (!hw) err("homework: обязательна");
  else {
    str(hw.title, "homework.title", 120);
    optStr(hw.intro, "homework.intro", 400);
    if (!hw.steps?.length) err("homework.steps: нужны шаги");
    (hw.steps ?? []).forEach((s, j) => step(s, `homework.steps[${j}]`));
    checkPromptRefs(hw.steps ?? [], "homework");
    str(hw.deliverable, "homework.deliverable", 400);
  }
  (lesson.safety ?? []).forEach((s, i) => str(s, `safety[${i}]`, 260));
  (lesson.materials ?? []).forEach((s, i) => str(s, `materials[${i}]`, 300));

  const stars = (lesson.tasks ?? []).reduce(
    (sum, t) => sum + (t.aiActions ?? []).reduce((s, a) => s + (a.stars ?? 0), 0),
    0,
  );

  if (problems.length) {
    console.log(`✗ ${file}`);
    for (const m of problems) console.log(`   ошибка: ${m}`);
    errors += problems.length;
  } else {
    console.log(`✓ ${file} — ${lesson.tasks.length} заданий, тест 10, правильный самый длинный: ${longest}/10, позиции ${positions.join("/")}, ★ кнопок: ${stars}`);
  }
  for (const m of notes) console.log(`   внимание: ${m}`);
  warnings += notes.length;
}

console.log(`\nОшибок: ${errors}, предупреждений: ${warnings}`);
process.exit(errors ? 1 : 0);
