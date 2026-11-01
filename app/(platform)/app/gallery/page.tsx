import type { Metadata } from "next";
import { ComingSoon } from "@/components/platform/ComingSoon";

export const metadata: Metadata = { title: "Галерея" };

export default function GalleryPage() {
  return (
    <ComingSoon
      title="Галерея"
      text="Здесь будут все ваши генерации: картинки, озвучки, музыка и клипы. Их можно будет подставлять в следующие задания."
    />
  );
}
