#!/usr/bin/env node
/*
  Юнит-тесты расписания опроса задач генерации и длины MP4 (без базы, сети и Next.js):
  интервалы шлюза на сервере, паузы и разброс в браузере, счёт проверок статуса за видео.
  Запуск из корня репозитория:  node lib/platform/tests/run.mjs
*/
import { tests } from "../../server/bot/tests/harness.mjs";

await import("./job-poll.test.mjs");
await import("./mp4-duration.test.mjs");
await import("./music-lipsync.test.mjs");

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
