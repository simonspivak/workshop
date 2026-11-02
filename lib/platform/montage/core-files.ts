/*
  Файлы ffmpeg.wasm, которые лежат в public/ffmpeg (свой хостинг, без CDN и без COOP/COEP).

  - ffmpeg-core.js / .wasm — @ffmpeg/core (однопоточное ядро, ffmpeg 5.1, GPL-2.0-or-later);
  - classes.js, worker.js, const.js, errors.js, utils.js — ESM-сборка @ffmpeg/ffmpeg (MIT).
    Класс FFmpeg грузится в браузере через import() мимо бандлера: Turbopack не умеет
    `new Worker(new URL(переменная, import.meta.url))` из classes.js, а воркеру нужен
    нетронутый import(coreURL). В бандл попадают только типы из пакета.

  Версии закреплены в package.json точно. Обновили пакет — скопируйте файлы заново
  (node_modules/<from> → public/<path>) и поправьте sha256: `npm run test:montage` сверяет всё.
  sha256 нужен и браузеру: если свой файл не загрузился, ядро берётся с jsDelivr
  и принимается, только если хэш совпал.

  Без импортов: файл читает и браузер, и Node-тест.
*/

export const FFMPEG_CORE_VERSION = "0.12.10";
export const FFMPEG_PACKAGE_VERSION = "0.12.15";

export type CoreFile = {
  /** путь в public/ (и на сайте от корня) */
  path: string;
  /** откуда копировать, от node_modules/ */
  from: string;
  sha256: string;
  bytes: number;
  /** запасной адрес; только для ядра */
  cdn?: string;
};

const CDN = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;

export const CORE_JS: CoreFile = {
  path: "ffmpeg/ffmpeg-core.js",
  from: "@ffmpeg/core/dist/esm/ffmpeg-core.js",
  sha256: "67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3",
  bytes: 111804,
  cdn: `${CDN}/ffmpeg-core.js`,
};

export const CORE_WASM: CoreFile = {
  path: "ffmpeg/ffmpeg-core.wasm",
  from: "@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
  sha256: "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7",
  bytes: 32232419,
  cdn: `${CDN}/ffmpeg-core.wasm`,
};

export const WORKER_JS: CoreFile = {
  path: "ffmpeg/worker.js",
  from: "@ffmpeg/ffmpeg/dist/esm/worker.js",
  sha256: "feff0ac937ea225e997e1fae997a74f8b8d572423a526da59eb56624b1f3cde7",
  bytes: 5085,
};

/** Модуль с классом FFmpeg (воркер он находит рядом: ./worker.js). */
export const CLASSES_JS: CoreFile = {
  path: "ffmpeg/classes.js",
  from: "@ffmpeg/ffmpeg/dist/esm/classes.js",
  sha256: "7a829c898bdbc3a8806652a5502d9101178ce4e988a2c50b3abc1306ce4fc919",
  bytes: 9747,
};

export const CORE_FILES: readonly CoreFile[] = [
  CORE_JS,
  CORE_WASM,
  CLASSES_JS,
  WORKER_JS,
  {
    path: "ffmpeg/utils.js",
    from: "@ffmpeg/ffmpeg/dist/esm/utils.js",
    sha256: "8c2e0e16445f8d3a0acbb812f2c60541a92c88ed0bf9ffe96c52e7fb6c8b1d72",
    bytes: 138,
  },
  {
    path: "ffmpeg/const.js",
    from: "@ffmpeg/ffmpeg/dist/esm/const.js",
    sha256: "9e3bc9dd84781c81daf459e2c46eeec815edac35089832681d9a9a0f383060d0",
    bytes: 1016,
  },
  {
    path: "ffmpeg/errors.js",
    from: "@ffmpeg/ffmpeg/dist/esm/errors.js",
    sha256: "619310d7ef5fe5fefa0a31927db862b7c291713cfef4d71753fa8aafd18f4db6",
    bytes: 332,
  },
];

/** Шрифт субтитров (OFL, public/fonts/OFL.txt). */
export const FONT_URL = "/fonts/Onest-Bold.ttf";
