/*
  Минимальные MP4 (ISO-BMFF) из байтов для тестов: коробки ftyp, moov(mvhd), mdat.
  Видео внутри нет — длину читатель берёт только из mvhd. Бинарных файлов в репозитории нет.
*/

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function u32(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function u64(n) {
  return concat(u32(Math.floor(n / 2 ** 32)), u32(n % 2 ** 32));
}

/** Коробка с 32-битным размером. */
export function box(type, ...payload) {
  const body = concat(...payload);
  return concat(u32(8 + body.length), ascii(type), body);
}

/** Коробка с 64-битным размером (size = 1, largesize). */
export function box64(type, ...payload) {
  const body = concat(...payload);
  return concat(u32(1), ascii(type), u64(16 + body.length), body);
}

export const ftyp = () => box("ftyp", ascii("isom"), u32(512), ascii("isomavc1"));

/** mvhd версии 0 (32-битные поля) или 1 (64-битные). */
export function mvhd({ timescale, duration, version = 0 }) {
  const rest = new Uint8Array(80); // rate, volume, reserved, matrix, pre_defined, next_track_ID
  if (version === 1) return box("mvhd", new Uint8Array([1, 0, 0, 0]), u64(0), u64(0), u32(timescale), u64(duration), rest);
  return box("mvhd", new Uint8Array([0, 0, 0, 0]), u32(0), u32(0), u32(timescale), u32(duration), rest);
}

export const moov = (...children) => box("moov", ...children);
export const mdat = (bytes) => box("mdat", new Uint8Array(bytes));
export const trak = () => box("trak", box("tkhd", new Uint8Array(84)));

/** faststart: ftyp, moov, mdat. */
export function faststart(seconds, { version = 0, timescale = 1000, mdatBytes = 300 * 1024 } = {}) {
  return concat(ftyp(), moov(mvhd({ timescale, duration: Math.round(seconds * timescale), version }), trak()), mdat(mdatBytes));
}

/** moov в конце: ftyp, (free), mdat, moov. */
export function moovAtEnd(seconds, { version = 0, timescale = 1000, mdatBytes = 300 * 1024 } = {}) {
  return concat(
    ftyp(),
    box("free", new Uint8Array(8)),
    mdat(mdatBytes),
    moov(mvhd({ timescale, duration: Math.round(seconds * timescale), version }), trak()),
  );
}

/**
 * Подмена fetch: файл bytes по ссылке, Range как у Storage (206 + Content-Range).
 * ignoreRange — сервер отдаёт файл целиком (200); тело — поток кусками по 16 КБ, чтобы было видно,
 * сколько на самом деле прочитали. stats: запросы, отданные байты.
 */
export function fileServer(bytes, { ignoreRange = false, status } = {}) {
  const stats = { requests: [], bytesServed: 0 };
  const fetch = async (_url, init = {}) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range ?? "");
    stats.requests.push(range ? [Number(range[1]), Number(range[2])] : null);
    if (status) return new Response(null, { status });
    let start = 0;
    let end = bytes.length - 1;
    let code = 200;
    const headers = { "content-length": "" };
    if (range && !ignoreRange) {
      start = Number(range[1]);
      if (start >= bytes.length) return new Response(null, { status: 416 });
      end = Math.min(Number(range[2]), bytes.length - 1);
      code = 206;
      headers["content-range"] = `bytes ${start}-${end}/${bytes.length}`;
    }
    headers["content-length"] = String(end - start + 1);
    let at = start;
    const body = new ReadableStream({
      pull(controller) {
        if (at > end) return controller.close();
        const chunk = bytes.slice(at, Math.min(at + 16 * 1024, end + 1));
        at += chunk.length;
        stats.bytesServed += chunk.length;
        controller.enqueue(chunk);
      },
    });
    return new Response(body, { status: code, headers });
  };
  return { fetch, stats };
}
