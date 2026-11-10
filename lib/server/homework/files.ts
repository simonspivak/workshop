import { HOMEWORK_EXTENSIONS, type HomeworkExt } from "@/lib/platform/homework-types";

/*
  Файлы домашек: тип определяется по расширению имени файла (браузер для .md и .pptx часто
  присылает пустой или странный MIME), в Storage файл кладётся с каноническим Content-Type
  из таблицы ниже (бакет media принимает только эти типы). После загрузки сервер сверяет
  первые байты файла с расширением — чтобы под именем .pdf не лежало что-то другое.
  Чистый модуль без зависимостей: его проверяют юнит-тесты.
*/

export type FileClass = "document" | "image" | "video" | "audio";

const FILE_TYPES: Record<HomeworkExt, { mime: string; cls: FileClass }> = {
  pdf: { mime: "application/pdf", cls: "document" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", cls: "document" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", cls: "document" },
  txt: { mime: "text/plain", cls: "document" },
  md: { mime: "text/markdown", cls: "document" },
  png: { mime: "image/png", cls: "image" },
  jpg: { mime: "image/jpeg", cls: "image" },
  jpeg: { mime: "image/jpeg", cls: "image" },
  webp: { mime: "image/webp", cls: "image" },
  mp4: { mime: "video/mp4", cls: "video" },
  mp3: { mime: "audio/mpeg", cls: "audio" },
  m4a: { mime: "audio/mp4", cls: "audio" },
  wav: { mime: "audio/wav", cls: "audio" },
};

/** Расширение из имени файла (в нижнем регистре); null — такой файл не принимается. */
export function homeworkExt(fileName: string): HomeworkExt | null {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return (HOMEWORK_EXTENSIONS as readonly string[]).includes(ext) ? (ext as HomeworkExt) : null;
}

export function homeworkMime(ext: HomeworkExt): string {
  return FILE_TYPES[ext].mime;
}

export function fileClass(ext: HomeworkExt): FileClass {
  return FILE_TYPES[ext].cls;
}

/** Расширение по пути в Storage ({user}/homework/{id}.{ext}); null — не файл домашки. */
export function extOfPath(path: string | null | undefined): HomeworkExt | null {
  return path ? homeworkExt(path) : null;
}

/** Имя файла без управляющих символов и путей, до 200 символов. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  if (cleaned.length <= 200) return cleaned;
  const ext = homeworkExt(cleaned);
  return ext ? `${cleaned.slice(0, 200 - ext.length - 1)}.${ext}` : cleaned.slice(0, 200);
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Первые байты файла совпадают с расширением. Для txt/md проверки нет (это просто текст). */
export function headMatchesExt(head: Uint8Array, ext: HomeworkExt): boolean {
  if (ext === "txt" || ext === "md") return true;
  if (head.length < 12) return false;
  switch (ext) {
    case "pdf":
      return ascii(head, 0, 4) === "%PDF";
    case "pptx":
    case "docx":
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    case "png":
      return head[0] === 0x89 && ascii(head, 1, 4) === "PNG";
    case "jpg":
    case "jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "webp":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    case "wav":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE";
    case "mp4":
    case "m4a":
      return ascii(head, 4, 8) === "ftyp";
    case "mp3":
      return ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  }
}
