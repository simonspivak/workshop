import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { site } from "@/content/site";

const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * Находит файл в папке public. Если указан hero.jpg, а лежит hero.png —
 * тоже найдёт: подходит любое из расширений выше.
 */
function findPublicFile(src: string): string | null {
  const publicDir = path.join(process.cwd(), "public");
  const ext = path.extname(src);
  const base = src.slice(0, src.length - ext.length);
  for (const candidate of [src, ...EXTENSIONS.map((e) => base + e)]) {
    if (fs.existsSync(path.join(publicDir, candidate))) return candidate;
  }
  return null;
}

/**
 * Картинка из папки public. Пока файла нет — показывает заглушку
 * с подписью «сюда картинка: …» и путём, куда положить файл.
 */
export function ImageSlot({
  src,
  alt,
  placeholder,
  aspect = "aspect-[4/3]",
  sizes,
  priority = false,
  className = "",
  imgClassName = "",
}: {
  src: string;
  alt: string;
  placeholder: string;
  aspect?: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  const file = findPublicFile(src);

  if (file) {
    return (
      <div className={`relative overflow-hidden ${aspect} ${className}`}>
        <Image
          src={file}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={`object-cover ${imgClassName}`}
        />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={`placeholder-stripes flex flex-col items-center justify-center gap-2 border-2 border-dashed border-cobalt/30 p-4 text-center ${aspect} ${className}`}
    >
      <ImageIcon aria-hidden="true" className="size-7 text-cobalt" strokeWidth={1.5} />
      <p className="max-w-[28ch] text-sm font-medium text-ink">
        {site.placeholderPrefix} {placeholder}
      </p>
      <p className="font-mono text-xs text-ink-soft">public{src}</p>
    </div>
  );
}
