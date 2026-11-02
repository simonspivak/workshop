import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Публичный сайт: та же шапка и подвал, что и раньше
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
