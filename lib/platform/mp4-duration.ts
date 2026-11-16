/*
  Длительность MP4 (ISO-BMFF) без зависимостей и без скачивания файла целиком.
  Файл — дерево «коробок»: [размер 4 байта][тип 4 буквы][содержимое]. Размер 1 — дальше 8 байт
  настоящего размера (64 бита), размер 0 — коробка до конца файла. Длительность лежит в moov → mvhd:
  duration / timescale (версия 0 — 32-битные поля, версия 1 — 64-битные).

  moov бывает в начале (faststart: ftyp, moov, mdat) или в конце (ftyp, mdat, moov). Читаем кусками
  через read(offset, length):
    1) первые MP4_HEAD_BYTES (64 КБ) — faststart на этом заканчивается;
    2) иначе идём по размерам коробок верхнего уровня (mdat говорит, где кончается) и читаем
       MP4_HEAD_BYTES с начала следующей коробки — обычно это уже moov;
    3) если коробки сломаны, а полный размер файла известен — последние MP4_TAIL_BYTES (256 КБ)
       и поиск mvhd в них.
  Не больше MP4_MAX_READS чтений. Не разобрали — ok: false («неизвестно»), а не ноль секунд.
  Модуль чистый: без сети и Node API, его можно звать и в браузере, и в тестах на байтах.
*/

export const MP4_HEAD_BYTES = 64 * 1024;
export const MP4_TAIL_BYTES = 256 * 1024;
export const MP4_MAX_READS = 4;
const MAX_TOP_BOXES = 64;

/** Кусок файла и полный размер файла, если сервер его сообщил (Content-Range / Content-Length). */
export type Mp4Chunk = { bytes: Uint8Array; total: number | null };
/** Прочитать до length байт с offset. null — не вышло (сеть, 4xx/5xx). */
export type Mp4RangeReader = (offset: number, length: number) => Promise<Mp4Chunk | null>;

export type Mp4Failure = "read_failed" | "not_mp4" | "no_moov" | "bad_mvhd";
export type Mp4DurationResult =
  | { ok: true; seconds: number; bytesRead: number; reads: number }
  | { ok: false; reason: Mp4Failure; bytesRead: number; reads: number };

export type Mp4ReadOptions = { headBytes?: number; tailBytes?: number };

/** Типы, с которых начинается MP4 / QuickTime. Остальное в начале файла — не MP4. */
const FIRST_BOX_TYPES = new Set(["ftyp", "styp", "free", "skip", "wide", "mdat", "moov", "pnot", "uuid"]);

type Box = { type: string; size: number | "eof"; header: number };

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function fourcc(b: Uint8Array, at: number): string | null {
  let s = "";
  for (let i = 0; i < 4; i++) {
    const c = b[at + i];
    // печатный ASCII и «©» (0xA9, коробки метаданных QuickTime)
    if (!((c >= 0x20 && c <= 0x7e) || c === 0xa9)) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Заголовок коробки в b с позиции at: "short" — не хватает байт, "bad" — не похоже на коробку. */
function boxAt(b: Uint8Array, at: number): Box | "short" | "bad" {
  if (at < 0 || at + 8 > b.length) return "short";
  const size32 = u32(b, at);
  const type = fourcc(b, at + 4);
  if (!type) return "bad";
  if (size32 === 1) {
    if (at + 16 > b.length) return "short";
    const size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
    if (!Number.isSafeInteger(size) || size < 16) return "bad";
    return { type, size, header: 16 };
  }
  if (size32 === 0) return { type, size: "eof", header: 8 };
  if (size32 < 8) return "bad";
  return { type, size: size32, header: 8 };
}

/**
 * Длительность из содержимого mvhd (с байта версии) до end. null — поле пустое или неизвестно:
 * timescale 0, duration 0 (фрагментированный MP4) или «все единицы».
 */
export function mvhdSeconds(b: Uint8Array, at: number, end: number): number | null {
  if (at >= end) return null;
  const version = b[at];
  let timescale: number;
  let duration: number;
  if (version === 0) {
    if (at + 20 > end) return null;
    timescale = u32(b, at + 12);
    duration = u32(b, at + 16);
    if (duration === 0xffffffff) return null;
  } else if (version === 1) {
    if (at + 32 > end) return null;
    timescale = u32(b, at + 20);
    const hi = u32(b, at + 24);
    const lo = u32(b, at + 28);
    if (hi === 0xffffffff && lo === 0xffffffff) return null;
    duration = hi * 2 ** 32 + lo;
  } else {
    return null;
  }
  if (!timescale || !duration) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) ? seconds : null;
}

/** mvhd среди детей moov (from..end — содержимое moov в b). */
function mvhdInMoov(b: Uint8Array, from: number, end: number): number | null {
  for (let at = from; at < end; ) {
    const box = boxAt(b, at);
    if (box === "short" || box === "bad") return null;
    const boxEnd = box.size === "eof" ? end : Math.min(end, at + box.size);
    if (box.type === "mvhd") return mvhdSeconds(b, at + box.header, boxEnd);
    if (box.size === "eof") return null;
    at += box.size;
  }
  return null;
}

/** Запасной путь: найти mvhd в куске (хвост файла) по сигнатуре. */
function findMvhd(b: Uint8Array): number | null {
  for (let i = 4; i + 4 <= b.length; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue; // "mvhd"
    const size = u32(b, i - 4);
    // mvhd v0 — 108 байт, v1 — 120; чуть больше — допустимо
    if (size < 108 || size > 256 || i - 4 + size > b.length) continue;
    const seconds = mvhdSeconds(b, i + 4, i - 4 + size);
    if (seconds !== null) return seconds;
  }
  return null;
}

/** Длительность MP4 в секундах, читая файл кусками через read. */
export async function readMp4Duration(read: Mp4RangeReader, options: Mp4ReadOptions = {}): Promise<Mp4DurationResult> {
  const headBytes = options.headBytes ?? MP4_HEAD_BYTES;
  const tailBytes = options.tailBytes ?? MP4_TAIL_BYTES;
  let bytesRead = 0;
  let reads = 0;
  let total: number | null = null;
  let win: { start: number; bytes: Uint8Array } = { start: 0, bytes: new Uint8Array(0) };

  const fetchAt = async (offset: number, length: number): Promise<boolean> => {
    if (reads >= MP4_MAX_READS || length <= 0) return false;
    reads++;
    let chunk: Mp4Chunk | null;
    try {
      chunk = await read(offset, length);
    } catch {
      chunk = null;
    }
    if (!chunk) return false;
    const bytes = chunk.bytes.length > length ? chunk.bytes.subarray(0, length) : chunk.bytes;
    bytesRead += bytes.length;
    if (chunk.total !== null && Number.isSafeInteger(chunk.total) && chunk.total > 0) total = chunk.total;
    win = { start: offset, bytes };
    return bytes.length > 0;
  };
  const fail = (reason: Mp4Failure): Mp4DurationResult => ({ ok: false, reason, bytesRead, reads });
  const done = (seconds: number): Mp4DurationResult => ({ ok: true, seconds, bytesRead, reads });

  const tailScan = async (): Promise<Mp4DurationResult> => {
    if (total === null) return fail("no_moov");
    const start = Math.max(0, total - tailBytes);
    if (!(await fetchAt(start, total - start))) return fail(reads >= MP4_MAX_READS ? "no_moov" : "read_failed");
    const seconds = findMvhd(win.bytes);
    return seconds === null ? fail("no_moov") : done(seconds);
  };

  if (!(await fetchAt(0, headBytes))) return fail("read_failed");

  let pos = 0;
  for (let i = 0; i < MAX_TOP_BOXES; i++) {
    const fileSize = total as number | null;
    if (fileSize !== null && pos >= fileSize) return fail(i === 0 ? "not_mp4" : "no_moov");
    let box = boxAt(win.bytes, pos - win.start);
    if (box === "short") {
      // заголовок следующей коробки за пределами прочитанного: читаем с её начала
      if (fileSize !== null && pos + 8 > fileSize) return fail("no_moov");
      if (!(await fetchAt(pos, headBytes))) return fail(reads >= MP4_MAX_READS ? "no_moov" : "read_failed");
      box = boxAt(win.bytes, 0);
      if (box === "short") return fail("no_moov");
    }
    if (box === "bad") return i === 0 ? fail("not_mp4") : tailScan();
    if (i === 0 && !FIRST_BOX_TYPES.has(box.type)) return fail("not_mp4");

    if (box.type === "moov") {
      const size = box.size === "eof" ? (fileSize !== null ? fileSize - pos : headBytes) : box.size;
      const wanted = Math.min(size, headBytes);
      const have = win.start + win.bytes.length - pos;
      if (have < wanted && !(await fetchAt(pos, wanted))) return fail("read_failed");
      const local = pos - win.start;
      const seconds = mvhdInMoov(win.bytes, local + box.header, Math.min(win.bytes.length, local + size));
      return seconds === null ? fail("bad_mvhd") : done(seconds);
    }
    // коробка «до конца файла» не moov — moov дальше быть не может
    if (box.size === "eof") return fail("no_moov");
    pos += box.size;
  }
  return fail("no_moov");
}

/** Длительность MP4, целиком лежащего в памяти (тесты, файлы в браузере). */
export function mp4DurationFromBytes(bytes: Uint8Array): Promise<Mp4DurationResult> {
  return readMp4Duration(async (offset, length) => ({ bytes: bytes.subarray(offset, offset + length), total: bytes.length }));
}
