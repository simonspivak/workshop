import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isSupabaseConfigured, supabasePublicConfig } from "@/lib/server/env";
import { isTransientAuthError, sessionCookieOptions } from "@/lib/server/supabase/session-cookies";

/*
  Proxy (бывший middleware) для платформы:
    1) обновляет сессию Supabase (getClaims проверяет подпись и при необходимости
       обновляет токен, новые cookie уходят в ответ);
    2) оптимистично отправляет без сессии с /app и /teach на /login;
    3) /admin — задел под страницу админа (её пока нет): ведёт в /teach, где админ видит все группы.
  Если обновление токена упало на 429 или 5xx Supabase Auth, cookie не трогаем и на /login
  не отправляем: refresh-токен цел, следующий запрос попробует снова (аудит № 11).
  В базу не ходит. Это НЕ авторизация: права проверяет DAL в каждой странице,
  Server Action и Route Handler. Публичный сайт сюда не попадает (см. matcher).
*/

const PROTECTED = ["/app", "/teach", "/admin"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function toLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/teach";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const hasSessionCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));

  // Нет cookie сессии или платформа не настроена: в Supabase не ходим
  if (!hasSessionCookie || !isSupabaseConfigured()) {
    return isProtected(pathname) ? toLogin(request) : NextResponse.next({ request });
  }

  const { url, publishableKey } = supabasePublicConfig();
  // Записи cookie копим и применяем после getClaims: при временном сбое их нужно выбросить
  const pending: { cookies: CookieToSet[]; headers: Record<string, string> }[] = [];

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        pending.push({ cookies: cookiesToSet, headers: headers ?? {} });
      },
    },
  });

  // Между созданием клиента и getClaims ничего не вставлять: здесь обновляется токен
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && isTransientAuthError(error)) {
    // Supabase Auth перегружен или недоступен: прежние cookie остаются, без редиректа на /login
    console.warn("proxy: session refresh unavailable", { status: (error as { status?: number }).status ?? null });
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  for (const batch of pending) {
    for (const { name, value } of batch.cookies) request.cookies.set(name, value);
    response = NextResponse.next({ request });
    for (const { name, value, options } of batch.cookies) response.cookies.set(name, value, options);
    // Ответ с новыми cookie сессии нельзя кешировать (иначе чужой токен уйдёт другому)
    for (const [key, value] of Object.entries(batch.headers)) response.headers.set(key, value);
  }

  if (!signedIn && isProtected(pathname)) {
    const redirect = toLogin(request);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

export const config = {
  // Только платформа. Вебхук Telegram (/api/tg/…) ходит без cookie и сюда не попадает.
  matcher: ["/app/:path*", "/teach/:path*", "/admin/:path*", "/login", "/b/:path*", "/api/((?!tg/).*)"],
};
