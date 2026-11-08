"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/*
  Прослушивание озвучек и музыки до выбора: в студии (реплика к сцене, трек) и в формах
  генерации (озвучка для «говорящей головы»). Один общий плеер на панель: включился новый —
  старый замолчал; панель размонтировалась — плеер остановился.
*/

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

export type AudioPreview = Pick<ReturnType<typeof useAudioPreview>, "playing" | "toggle">;

/** Круглая кнопка «послушать / остановить», 44 px — удобно пальцем. */
export function PlayButton({
  playing,
  onClick,
  label,
  className = "",
}: {
  playing: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={playing ? `Остановить: ${label}` : `Послушать: ${label}`}
      aria-pressed={playing}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-lavender text-violet transition-colors hover:bg-glow ${className}`}
    >
      {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
    </button>
  );
}
