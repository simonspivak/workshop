import { inflateRawSync } from "node:zlib";

/*
  Минимальный читатель zip для pptx и docx (это zip с XML внутри): центральный каталог →
  локальные заголовки → deflate через node:zlib. Без zip64, без шифрования, без потоков —
  файлы домашек маленькие. Лишних зависимостей не нужно.
*/

export type ZipEntry = { name: string; size: number; read: () => Uint8Array };

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_ENTRIES = 5000;
/** распакованный размер одного файла внутри архива (XML слайда больше не бывает) */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

/** Список файлов архива. Содержимое читается лениво: entry.read(). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  // End of central directory: с конца, комментарий архива — до 65535 байт
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(at) === EOCD_SIG) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new ZipError("not a zip archive");
  const count = u16(eocd + 10);
  const cdirOffset = u32(eocd + 16);
  if (count > MAX_ENTRIES) throw new ZipError("too many entries");
  if (cdirOffset >= bytes.length) throw new ZipError("bad central directory");

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let at = cdirOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CDIR_SIG) throw new ZipError("bad central directory entry");
    const method = u16(at + 10);
    const compressedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const localOffset = u32(at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    entries.push({
      name,
      size,
      read: () => {
        if (localOffset + 30 > bytes.length || u32(localOffset) !== LOCAL_SIG) throw new ZipError("bad local header");
        const start = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
        if (start + compressedSize > bytes.length) throw new ZipError("entry out of range");
        const data = bytes.subarray(start, start + compressedSize);
        if (size > MAX_ENTRY_BYTES) throw new ZipError("entry too large");
        if (method === 0) return data;
        if (method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
        throw new ZipError(`unsupported compression method ${method}`);
      },
    });
  }
  return entries;
}
