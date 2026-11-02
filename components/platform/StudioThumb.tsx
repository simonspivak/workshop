"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, ImageIcon, Pause, Play } from "lucide-react";
import type { StudioMediaItem } from "@/lib/platform/montage/types";

/**
 * Превью клипа или картинки 9:16. Видео подгружается, только когда превью видно на экране:
 * в галерее могут быть десятки клипов, качать их все сразу на телефоне незачем.
 */
export function StudioThumb({ item, className = "" }: { item: StudioMediaItem; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || item.kind !== "video") return;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.kind]);

  return (
    <div ref={ref} className={`relative aspect-[9/16] overflow-hidden rounded-2xl bg-ink/90 ${className}`}>
      {item.kind === "image" ? (
        <Image src={item.url} alt="" fill unoptimized sizes="160px" className="object-cover" />
      ) : visible ? (
        <video
          src={`${item.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 p-1 text-white">
        {item.kind === "image" ? (
          <ImageIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <Clapperboard aria-hidden="true" className="size-3.5" />
        )}
      </span>
    </div>
  );
}

/** Один общий плеер для прослушивания реплик и музыки: включился новый — старый замолчал. */
export function useAudioPreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  const toggle = useCallback(
    (id: string, url: string) => {
      if (!audio.current) {
        audio.current = new Audio();
        audio.current.addEventListener("ended", () => setPlaying(null));
        audio.current.addEventListener("error", () => setPlaying(null));
      }
      const el = audio.current;
      if (playing === id) {
        el.pause();
        setPlaying(null);
        return;
      }
      el.pause();
      el.src = url;
      el.currentTime = 0;
      void el.play().then(
        () => setPlaying(id),
        () => setPlaying(null),
      );
    },
    [playing],
  );

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
  }, []);

  return { playing, toggle, stop };
}

export function PlayButton({
  playing,
  onClick,
  label,
}: {
  playing: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={playing ? `Остановить: ${label}` : `Послушать: ${label}`}
      aria-pressed={playing}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-lavender text-violet transition-colors hover:bg-glow"
    >
      {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
    </button>
  );
}
