#!/usr/bin/env node
/*
  Юнит-тесты чистой логики бота (без базы, сети и Next.js): разбор заявок, лимиты, срок жизни,
  адреса, CSV, промпт, модерация и защита от утечки характера.
  Запуск из корня репозитория:  node lib/server/bot/tests/run.mjs
*/
import { tests } from "./harness.mjs";

await import("./pure.test.mjs");
await import("./brain.test.mjs");
await import("./telegram.test.mjs");

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
