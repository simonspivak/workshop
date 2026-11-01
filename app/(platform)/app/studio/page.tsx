import type { Metadata } from "next";
import { ComingSoon } from "@/components/platform/ComingSoon";

export const metadata: Metadata = { title: "Монтаж" };

export default function StudioPage() {
  return (
    <ComingSoon
      title="Монтаж"
      text="Автомонтаж к уроку 2: клипы из галереи, реплики, музыка и субтитры — склейка прямо в браузере."
    />
  );
}
