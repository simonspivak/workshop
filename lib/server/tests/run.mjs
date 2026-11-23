#!/usr/bin/env node
/*
  Юнит-тесты серверной части без базы, сети и Next.js: вход и отчёт группы, клиент шлюза,
  кеш ссылок Storage, срок сохранения результата, обход брошенных задач, текст после списания, кабинет ведущего,
  личные данные (удаление ученика, сроки хранения, согласие, общая галерея, засчитанный тест),
  длина образца переноса движения и результат больше лимита бакета,
  длина озвучки для говорящей головы и длина/голос музыки.
  Запуск из корня репозитория:  node lib/server/tests/run.mjs
*/
import { tests } from "../bot/tests/harness.mjs";

await import("./login.test.mjs");
await import("./gateway.test.mjs");
await import("./storage.test.mjs");
await import("./deadline.test.mjs");
await import("./job-sweep.test.mjs");
await import("./generate-text.test.mjs");
await import("./teacher.test.mjs");
await import("./privacy.test.mjs");
await import("./job-callback.test.mjs");
await import("./motion-driver.test.mjs");
await import("./lipsync-music.test.mjs");

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
