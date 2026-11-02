/*
  Загрузчик TypeScript для тестов: транспиляция пакетом typescript (он уже в devDependencies),
  «@/…» — от корня репозитория, server-only подменяется пустым модулем (как под react-server).
  importTsWith(path, mocks) — загрузить модуль с подменой зависимостей (по точному specifier);
  у каждого набора подмен свой кеш модулей.
*/
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveFile(request, fromDir) {
  const base = request.startsWith("@/") ? path.join(root, request.slice(2)) : path.resolve(fromDir, request);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (isFile(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${request} from ${fromDir}`);
}

function makeLoader(mocks = {}) {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const source = readFileSync(file, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = (request) => {
      if (request in mocks) {
        const mock = mocks[request];
        return typeof mock === "function" ? mock((relative) => load(resolveFile(relative, root))) : mock;
      }
      if (request === "server-only") return {};
      if (request.startsWith("@/") || request.startsWith(".")) return load(resolveFile(request, path.dirname(file)));
      return require(request);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  };
  return load;
}

const defaultLoader = makeLoader();

export const importTs = (relative) => defaultLoader(resolveFile(relative, root));

/**
 * Загрузить модуль с подменами. Значение подмены — объект или функция (loadReal) => объект:
 * loadReal("@/…") даёт настоящий модуль (из того же кеша), чтобы переопределить пару функций.
 */
export function importTsWith(relative, mocks) {
  return makeLoader(mocks)(resolveFile(relative, root));
}

// ---------- регистрация тестов ----------

export const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}
