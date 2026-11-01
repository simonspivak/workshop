import type { NextConfig } from "next";

/*
  Заголовки безопасности.
  Сайт целиком — noindex (открывается только по ссылке) и базовые заголовки.
  Кабинет (/app, /teach, /admin, /login, /b, /api) — дополнительно статичная CSP без nonce:
  nonce несовместим с Cache Components и partial prefetching (см. docs Next.js «Without Nonces»).
  CSP публичного сайта не трогаем: там встроенный календарь Google и он должен работать как раньше.

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

const baseHeaders = [
  // Сайт открывается только по ссылке: просим поисковики не индексировать ничего, включая картинки
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const platformHeaders = [
  ...baseHeaders,
  { key: "Content-Security-Policy", value: csp({ ffmpeg: false }) },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
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
