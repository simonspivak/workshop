import type { Metadata } from "next";
import { ComingSoon } from "@/components/platform/ComingSoon";

export const metadata: Metadata = { title: "Мой бот" };

export default function BotPage() {
  return (
    <ComingSoon
      title="Мой бот"
      text="Конструктор бота к уроку 3: имя, «душа», аватар, инструменты, веб-чат и Telegram."
    />
  );
}
