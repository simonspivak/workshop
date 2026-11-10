#!/usr/bin/env node
/*
  Юнит-тесты домашек (без базы, сети и Next.js): zip-читатель, извлечение текста из pptx,
  docx, pdf и txt, типы файлов, промпт проверки и разбор ответа модели.
  Запуск из корня репозитория:  node lib/server/homework/tests/run.mjs
*/
import { tests } from "../../bot/tests/harness.mjs";

await import("./extract.test.mjs");

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed ? `\n${failed} из ${tests.length} тестов упали` : `\nВсе ${tests.length} тестов прошли`);
process.exit(failed ? 1 : 0);
