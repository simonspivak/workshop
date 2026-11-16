import assert from "node:assert/strict";
import { importTs, test } from "../../server/bot/tests/harness.mjs";
import { box, box64, concat, faststart, ftyp, mdat, moov, moovAtEnd, mvhd, trak, u32 } from "./mp4-fixtures.mjs";

/*
  Длительность MP4 по mvhd (lib/platform/mp4-duration.ts) на байтах, собранных в тесте:
  faststart и moov в конце, mvhd версии 0 и 1, 64-битные размеры, обрезанные и чужие файлы.
  «Не разобрали» — ok: false, никогда не ноль секунд.
*/

const { readMp4Duration, mp4DurationFromBytes, MP4_HEAD_BYTES } = importTs("@/lib/platform/mp4-duration");

/** Читатель по байтам в памяти; total — как в Content-Range (или null, если сервер его не дал). */
function reader(bytes, { withTotal = true } = {}) {
  const calls = [];
  const read = async (offset, length) => {
    calls.push([offset, length]);
    if (offset >= bytes.length) return null;
    return { bytes: bytes.slice(offset, offset + length), total: withTotal ? bytes.length : null };
  };
  return { read, calls };
}

test("mp4: faststart (ftyp, moov, mdat), mvhd v0 — одно чтение до 64 КБ", async () => {
  const file = faststart(10);
  const { read, calls } = reader(file);
  const result = await readMp4Duration(read);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 10);
  assert.equal(result.reads, 1);
  assert.deepEqual(calls, [[0, MP4_HEAD_BYTES]]);
  assert.equal(result.bytesRead, MP4_HEAD_BYTES);
});

test("mp4: moov в конце (ftyp, free, mdat, moov) — второе чтение ровно с начала moov по размеру mdat", async () => {
  const file = moovAtEnd(30, { mdatBytes: 900 * 1024 });
  const { read, calls } = reader(file);
  const result = await readMp4Duration(read);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 30);
  assert.equal(result.reads, 2);
  const moovAt = file.length - (8 + 108 + 8 + 92);
  assert.deepEqual(calls[1], [moovAt, MP4_HEAD_BYTES]);
  assert.ok(result.bytesRead <= MP4_HEAD_BYTES + 300, `прочитано ${result.bytesRead}`);
});

test("mp4: moov в конце, а сервер не сообщил размер файла — тоже находится по размерам коробок", async () => {
  const file = moovAtEnd(9.5);
  const result = await readMp4Duration(reader(file, { withTotal: false }).read);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 9.5);
});

test("mp4: mvhd версии 1 (64-битные поля), в том числе длительность больше 2^32", async () => {
  const v1 = await mp4DurationFromBytes(faststart(10.4, { version: 1, timescale: 90_000 }));
  assert.equal(v1.ok, true);
  assert.ok(Math.abs(v1.seconds - 10.4) < 1e-9);
  const huge = await mp4DurationFromBytes(
    concat(ftyp(), moov(mvhd({ version: 1, timescale: 1_000_000, duration: 5_000_000_000 })), mdat(16)),
  );
  assert.equal(huge.ok, true);
  assert.equal(huge.seconds, 5000);
  const end = await mp4DurationFromBytes(moovAtEnd(30, { version: 1, timescale: 600 }));
  assert.equal(end.seconds, 30);
});

test("mp4: mdat с 64-битным размером (size = 1) — moov за ним находится", async () => {
  const file = concat(ftyp(), box64("mdat", new Uint8Array(200 * 1024)), moov(mvhd({ timescale: 1000, duration: 10_600 })));
  const result = await mp4DurationFromBytes(file);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 10.6);
  assert.equal(result.reads, 2);
});

test("mp4: moov с 64-битным размером и mvhd не первым ребёнком", async () => {
  const file = concat(ftyp(), box64("moov", trak(), box("udta", new Uint8Array(20)), mvhd({ timescale: 25, duration: 250 })), mdat(64));
  const result = await mp4DurationFromBytes(file);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 10);
});

test("mp4: moov больше 64 КБ (длинный trak перед концом) — хватает начала с mvhd", async () => {
  const file = concat(ftyp(), mdat(100 * 1024), moov(mvhd({ timescale: 1000, duration: 7000 }), box("trak", new Uint8Array(200 * 1024))));
  const result = await mp4DurationFromBytes(file);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 7);
});

test("mp4: обрезанный файл без moov — no_moov (неизвестно), не ноль", async () => {
  const full = moovAtEnd(10);
  const cut = full.slice(0, 150 * 1024); // mdat объявлен на 300 КБ, файл кончился раньше
  const result = await mp4DurationFromBytes(cut);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_moov");
  assert.equal(result.seconds, undefined);
});

test("mp4: обрезано посреди mvhd — bad_mvhd", async () => {
  const full = faststart(10, { mdatBytes: 0 });
  // ftyp — 24 байта, moov с 24, mvhd с 32, его поля с 40: оставляем 10 байт полей
  const cut = full.slice(0, 50);
  const result = await mp4DurationFromBytes(cut);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad_mvhd");
});

test("mp4: duration 0 (фрагментированный MP4) и timescale 0 — неизвестно, а не 0 секунд", async () => {
  for (const fields of [{ timescale: 1000, duration: 0 }, { timescale: 0, duration: 1000 }, { timescale: 1000, duration: 0xffffffff }]) {
    const result = await mp4DurationFromBytes(concat(ftyp(), moov(mvhd(fields)), mdat(8)));
    assert.equal(result.ok, false, JSON.stringify(fields));
    assert.equal(result.reason, "bad_mvhd");
  }
});

test("mp4: мусор, WAV, пустой файл — не MP4", async () => {
  const garbage = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256);
  assert.equal((await mp4DurationFromBytes(garbage)).reason, "not_mp4");
  const wav = concat(Uint8Array.from("RIFF", (c) => c.charCodeAt(0)), u32(1000), Uint8Array.from("WAVEfmt ", (c) => c.charCodeAt(0)), new Uint8Array(64));
  assert.equal((await mp4DurationFromBytes(wav)).reason, "not_mp4");
  const text = Uint8Array.from("<html><body>not found</body></html>", (c) => c.charCodeAt(0));
  assert.equal((await mp4DurationFromBytes(text)).ok, false);
  assert.equal((await mp4DurationFromBytes(new Uint8Array(0))).reason, "read_failed");
});

test("mp4: mdat «до конца файла» (size 0) — moov после него быть не может", async () => {
  const file = concat(ftyp(), u32(0), Uint8Array.from("mdat", (c) => c.charCodeAt(0)), new Uint8Array(1000));
  const result = await mp4DurationFromBytes(file);
  assert.equal(result.reason, "no_moov");
});

test("mp4: сломанный размер коробки после mdat — последние 256 КБ и поиск mvhd", async () => {
  // mdat объявлен короче, чем есть: следующая «коробка» — байты 0xFF
  const file = concat(ftyp(), u32(8 + 1000), Uint8Array.from("mdat", (c) => c.charCodeAt(0)), new Uint8Array(4000).fill(0xff), moov(mvhd({ timescale: 1000, duration: 30_000 })));
  const result = await mp4DurationFromBytes(file);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 30);
});

test("mp4: чтение упало или бросило — read_failed; чтений не больше 4", async () => {
  assert.equal((await readMp4Duration(async () => null)).reason, "read_failed");
  assert.equal((await readMp4Duration(async () => Promise.reject(new Error("net")))).reason, "read_failed");
  // много мелких коробок подряд, каждая за пределами прочитанного: читатель не крутится вечно
  const file = moovAtEnd(10);
  let reads = 0;
  const result = await readMp4Duration(
    async (offset, length) => (reads++, { bytes: file.slice(offset, offset + Math.min(length, 40)), total: file.length }),
    { headBytes: 40 },
  );
  assert.ok(reads <= 4, `чтений ${reads}`);
  assert.equal(typeof result.ok, "boolean");
});
