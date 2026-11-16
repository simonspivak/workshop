import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { safeNext } from "./next-path";
import { getUser, homePath } from "@/lib/server/dal/auth";
import { Container, Skeleton } from "@/components/platform/ui";

export const metadata: Metadata = {
  title: "Вход",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Container className="py-10 sm:py-16">
      {/* Уже вошли (закладка на /login) — сразу в кабинет. Сессию читаем только за Suspense */}
      <Suspense fallback={null}>
        <SignedInGate searchParams={searchParams} />
      </Suspense>
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

/** Вошедшего ведёт в кабинет (или на ?next=). Отключённый аккаунт getUser не вернёт — форма останется. */
async function SignedInGate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  if (!user) return null;
  const { next } = await searchParams;
  redirect(safeNext(typeof next === "string" ? next : null) ?? homePath(user));
}
