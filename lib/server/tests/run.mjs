#!/usr/bin/env node
/*
  Юнит-тесты серверной части без базы, сети и Next.js: вход и отчёт группы, клиент шлюза,
  кеш ссылок Storage, срок сохранения результата, обход брошенных задач, текст после списания.
  Запуск из корня репозитория:  node lib/server/tests/run.mjs
*/
import { tests } from "../bot/tests/harness.mjs";

await import("./login.test.mjs");
await import("./gateway.test.mjs");
await import("./storage.test.mjs");
await import("./deadline.test.mjs");
await import("./job-sweep.test.mjs");
await import("./generate-text.test.mjs");

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
