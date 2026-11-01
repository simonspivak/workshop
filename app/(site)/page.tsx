import { Hero } from "@/components/home/Hero";
import { Marquee } from "@/components/home/Marquee";
import { Route } from "@/components/home/Route";
import { Session } from "@/components/home/Session";
import { Access } from "@/components/home/Access";
import { Booking } from "@/components/home/Booking";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Marquee />
      <Route />
      <Session />
      <Access />
      <Booking />
    </>
  );
}
