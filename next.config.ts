import type { NextConfig } from "next";

/*
  Заголовки безопасности.
  Сайт целиком — noindex (открывается только по ссылке) и базовые заголовки: запрет встраивать
  сайт в чужие страницы (кликджекинг), HSTS, Permissions-Policy и минимальная CSP только из
  frame-ancestors / base-uri / object-src — она не ограничивает скрипты, картинки и фреймы,
  поэтому встроенный календарь Google на публичном сайте работает как раньше.
  Кабинет (/app, /teach, /admin, /login, /b, /api) — полная статичная CSP без nonce:
  nonce несовместим с Cache Components и partial prefetching (см. docs Next.js «Without Nonces»).

  Адрес Supabase берётся из окружения сборки (на Vercel он есть и при сборке).
  Если его нет (локальная сборка без переменных) — разрешаем *.supabase.co.
*/

const isDev = process.env.NODE_ENV === "development";

function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (raw) {
      const url = new URL(raw);
      return [url.origin, `wss://${url.host}`];
    }
  } catch {
    // неверный адрес — ниже запасной вариант
  }
  return ["https://*.supabase.co", "wss://*.supabase.co"];
}

const supabase = supabaseOrigins().join(" ");
// Ядро ffmpeg.wasm для автомонтажа (этап B3) грузится с CDN или из /public
const ffmpegCdn = "https://unpkg.com https://cdn.jsdelivr.net";

function csp({ ffmpeg }: { ffmpeg: boolean }): string {
  return [
    "default-src 'self'",
    // 'unsafe-inline' нужен Next.js без nonce. Для монтажа: 'wasm-unsafe-eval' и blob: — ffmpeg.wasm в воркере
    `script-src 'self' 'unsafe-inline'${ffmpeg ? " 'wasm-unsafe-eval' blob:" : ""}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    `media-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' blob: data: ${supabase}${ffmpeg ? ` ${ffmpegCdn}` : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const permissionsPolicy = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()";

const baseHeaders = [
  // Сайт открывается только по ссылке: просим поисковики не индексировать ничего, включая картинки
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Только https. Без includeSubDomains: другие поддомены владельца могут жить без https
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: permissionsPolicy },
];

const platformOnly = [
  { key: "Content-Security-Policy", value: csp({ ffmpeg: false }) },
  { key: "X-Frame-Options", value: "DENY" },
  // Окна других сайтов не получают ссылку на кабинет (window.opener)
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Один ключ — один раз: два X-Frame-Options с разными значениями браузер может не понять
const platformHeaders = [
  ...baseHeaders.filter((header) => !platformOnly.some((own) => own.key === header.key)),
  ...platformOnly,
];

const studioHeaders = [{ key: "Content-Security-Policy", value: csp({ ffmpeg: true }) }];

const platformRoutes = ["/app", "/app/:path*", "/teach", "/teach/:path*", "/admin", "/admin/:path*", "/login", "/b/:path*", "/api/:path*"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      // Для одинаковых ключей побеждает последнее совпавшее правило
      ...platformRoutes.map((source) => ({ source, headers: platformHeaders })),
      { source: "/app/studio/:path*", headers: studioHeaders },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
