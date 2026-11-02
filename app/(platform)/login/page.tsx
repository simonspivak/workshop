import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { Container, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Вход",
};

export default function LoginPage() {
  return (
    <Container className="py-10 sm:py-16">
      <div className="mx-auto max-w-md">
        <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Кабинет курса</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Вход</h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-soft">
          Регистрации нет: логин и пароль выдаёт ведущий. Забыли пароль — попросите ведущего сбросить его.
        </p>
        <div className="mt-8 rounded-3xl bg-white p-5 ring-1 ring-ink/10 sm:p-6">
          {/* useSearchParams (параметр ?next) читается только в браузере */}
          <Suspense fallback={<Skeleton className="h-72" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </Container>
  );
}
