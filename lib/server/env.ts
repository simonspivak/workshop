import "server-only";
import { z } from "zod";

/*
  Единственное место в приложении, где читается process.env.

  Переменные читаются лениво, при первом обращении во время запроса, а не при импорте:
  так сборка проходит без переменных, а статичные страницы не «запекают» их значения.
  process.env читается целиком (динамически), поэтому Next.js не подставляет
  NEXT_PUBLIC_* на этапе сборки — значения берутся из окружения во время работы.

  Список переменных и откуда их брать — docs/platform/spec.md §9 и docs/platform/setup.md.
  Наружу (в ошибки, логи, ответы) значения не попадают — только имена переменных.
*/

const blankToUndefined = (value: unknown) =>
  typeof value === "string" ? (value.trim() === "" ? undefined : value.trim()) : value;

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const isLocalHost = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

// https обязателен; http допустим только для localhost (локальная разработка)
const serviceUrl = z.url().refine(
  (value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLocalHost(url));
  },
  { message: "must be an https URL" },
);

const base64Key32 = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "must be 32 bytes in base64 (openssl rand -base64 32)" },
);

const hostname = z
  .string()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "must be a domain name");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  NEXT_PUBLIC_SUPABASE_URL: optional(serviceUrl),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional(z.string().min(20)),
  SUPABASE_SECRET_KEY: optional(z.string().min(20)),
  KIE_GATEWAY_URL: optional(serviceUrl),
  KIE_GATEWAY_KEY: optional(z.string().min(16)),
  BOT_TOKEN_KEY: optional(base64Key32),
  STUDENT_EMAIL_DOMAIN: optional(hostname),
  APP_URL: optional(serviceUrl),
});

type Env = z.infer<typeof schema>;

/** Нужная переменная не задана или задана неверно. Сообщение содержит только имена переменных. */
export class ConfigError extends Error {
  readonly code = "not_configured";
  constructor(readonly variables: string[]) {
    super(`Platform is not configured: ${variables.join(", ")}`);
    this.name = "ConfigError";
  }
}

let cached: Env | null = null;

function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
    throw new ConfigError(names);
  }
  cached = parsed.data;
  return cached;
}

export function isDevelopment(): boolean {
  return env().NODE_ENV === "development";
}

/** Supabase подключён (есть адрес и publishable key). Без него платформа показывает заглушку. */
export function isSupabaseConfigured(): boolean {
  try {
    const e = env();
    return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  } catch {
    return false;
  }
}

/** Для клиента с сессией пользователя (cookies) и для proxy.ts. Ключ публичный по задумке. */
export function supabasePublicConfig(): { url: string; publishableKey: string } {
  const e = env();
  const missing = [
    !e.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name): name is string => Boolean(name));
  if (missing.length) throw new ConfigError(missing);
  return { url: e.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! };
}

/** Для admin-клиента (service_role). Только сервер. */
export function supabaseSecretConfig(): { url: string; secretKey: string } {
  const e = env();
  const missing = [
    !e.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !e.SUPABASE_SECRET_KEY && "SUPABASE_SECRET_KEY",
  ].filter((name): name is string => Boolean(name));
  if (missing.length) throw new ConfigError(missing);
  return { url: e.NEXT_PUBLIC_SUPABASE_URL!, secretKey: e.SUPABASE_SECRET_KEY! };
}

export type GatewayConfig = { mode: "live"; url: string; key: string } | { mode: "mock" };

/**
 * Шлюз kie в n8n. Если KIE_GATEWAY_URL не задан (Preview, локально) — mock-режим:
 * шлюз не вызывается, возвращаются заглушки. Если адрес задан, а ключа нет — это ошибка
 * настройки, а не повод молча переключиться на заглушки.
 */
export function gatewayConfig(): GatewayConfig {
  const e = env();
  if (!e.KIE_GATEWAY_URL) return { mode: "mock" };
  if (!e.KIE_GATEWAY_KEY) throw new ConfigError(["KIE_GATEWAY_KEY"]);
  return { mode: "live", url: e.KIE_GATEWAY_URL, key: e.KIE_GATEWAY_KEY };
}

/** Ключ AES-256-GCM для токенов Telegram-ботов (32 байта). */
export function botTokenKey(): Buffer {
  const key = env().BOT_TOKEN_KEY;
  if (!key) throw new ConfigError(["BOT_TOKEN_KEY"]);
  return Buffer.from(key, "base64");
}

/**
 * Домен технических адресов учеников: md1-lisa → md1-lisa@<домен>. Почты на нём нет.
 * Выбирается один раз: если поменять, старые ученики не смогут войти.
 */
export function studentEmailDomain(): string {
  return env().STUDENT_EMAIL_DOMAIN ?? "students.example.com";
}

/** Публичный адрес сайта (для вебхуков Telegram). null — если не задан. */
export function appUrl(): string | null {
  const value = env().APP_URL;
  return value ? value.replace(/\/+$/, "") : null;
}
