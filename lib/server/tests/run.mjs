#!/usr/bin/env node
/*
  Юнит-тесты клиента шлюза (без сети, базы и Next.js): повторы и разбор отказов kie.
  Запуск из корня репозитория:  node lib/server/tests/run.mjs
*/
import { tests } from "../bot/tests/harness.mjs";

await import("./gateway.test.mjs");

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
