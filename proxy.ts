import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabasePublicConfig } from "@/lib/server/env";

/*
  Proxy (бывший middleware) для платформы:
    1) обновляет сессию Supabase (getClaims проверяет подпись и при необходимости
       обновляет токен, новые cookie уходят в ответ);
    2) оптимистично отправляет без сессии с /app и /teach на /login.
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
  const hasSessionCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));

  // Нет cookie сессии или платформа не настроена: в Supabase не ходим
  if (!hasSessionCookie || !isSupabaseConfigured()) {
    return isProtected(pathname) ? toLogin(request) : NextResponse.next({ request });
  }

  const { url, publishableKey } = supabasePublicConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Ответ с новыми cookie сессии нельзя кешировать (иначе чужой токен уйдёт другому)
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Между созданием клиента и getClaims ничего не вставлять: здесь обновляется токен
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && isProtected(pathname)) {
    const redirect = toLogin(request);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

export const config = {
  // Только платформа. Вебхук Telegram (/api/tg/…) ходит без cookie и сюда не попадает.
  matcher: ["/app/:path*", "/teach/:path*", "/admin/:path*", "/login", "/b/:path*", "/api/((?!tg/).*)"],
};
