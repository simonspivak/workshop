#!/usr/bin/env node
/*
  Юнит-тесты входа, выхода, сброса пароля и отчёта по группе (без базы, сети и Next.js).
  Запуск из корня репозитория:  node lib/server/tests/run.mjs
*/
import { tests } from "../bot/tests/harness.mjs";

await import("./login.test.mjs");

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
