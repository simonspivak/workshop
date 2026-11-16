import "server-only";

/*
  Кеш подписанных ссылок Storage на инстанс сервера (аудит № 17, № 3).
  Раньше каждая отрисовка урока или галереи подписывала файлы заново: у каждой ссылки новый
  токен, поэтому браузер (и CDN Supabase) никогда не попадали в кеш и качали файл снова.
  Теперь одна и та же ссылка отдаётся повторно, пока до её истечения больше REUSE_MARGIN_MS.

  Ссылка живёт час (SIGNED_URL_TTL_SEC в storage.ts) и переиспользуется не дольше 45 минут:
  любая отданная ссылка действует ещё минимум 15 минут — дольше жизни любой страницы.

  Права: кеш знает только путь. Решает, какие пути можно подписать этому пользователю,
  вызывающий код (DAL, toJobViews, resolveReferences) — до обращения к кешу, как и раньше.
  Подписанная ссылка и раньше была «ссылкой на предъявителя» на час; кеш не выдаёт её тому,
  кто не прошёл проверку, и не продлевает её жизнь.

  Компромисс: кеш в памяти инстанса. Холодный старт его очищает, у разных инстансов Vercel —
  разные ссылки на один файл (браузер скачает файл по разу на инстанс). Зато нет общего
  хранилища, нечего синхронизировать между деплоями и нет устаревших ссылок после деплоя.
*/

export type SignedEntry = { url: string; expiresAt: number };
export type Signer = (paths: string[], ttlSec: number) => Promise<Map<string, string>>;

export const SIGNED_URL_REUSE_MARGIN_MS = 15 * 60_000;
export const SIGNED_URL_CACHE_MAX = 5_000;

export type SignedUrlCache = {
  /** Ссылки на пути: из кеша, если ещё долго живут, остальные — одним вызовом signer. */
  sign(paths: string[], signer: Signer): Promise<Map<string, SignedEntry>>;
  /** Забыть ссылки (файл перезаписан или удалён). */
  forget(paths: string[]): void;
  size(): number;
};

export function createSignedUrlCache(options: {
  ttlSec: number;
  marginMs?: number;
  maxEntries?: number;
  now?: () => number;
}): SignedUrlCache {
  const marginMs = options.marginMs ?? SIGNED_URL_REUSE_MARGIN_MS;
  const maxEntries = options.maxEntries ?? SIGNED_URL_CACHE_MAX;
  const now = options.now ?? Date.now;
  if (marginMs >= options.ttlSec * 1000) throw new Error("signed url cache: margin must be below ttl");
  // Map хранит порядок вставки: первый ключ — самый давно использованный
  const entries = new Map<string, SignedEntry>();

  return {
    async sign(paths, signer) {
      const unique = [...new Set(paths.filter(Boolean))];
      const result = new Map<string, SignedEntry>();
      const missing: string[] = [];
      const at = now();
      for (const path of unique) {
        const entry = entries.get(path);
        if (entry && entry.expiresAt - at > marginMs) {
          entries.delete(path);
          entries.set(path, entry);
          result.set(path, entry);
        } else {
          if (entry) entries.delete(path);
          missing.push(path);
        }
      }
      if (missing.length === 0) return result;

      // Срок считаем от момента до запроса: настоящий срок токена не раньше этого
      const signedAt = now();
      const fresh = await signer(missing, options.ttlSec);
      const expiresAt = signedAt + options.ttlSec * 1000;
      for (const [path, url] of fresh) {
        const entry = { url, expiresAt };
        entries.set(path, entry);
        result.set(path, entry);
      }
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return result;
    },
    forget(paths) {
      for (const path of paths) entries.delete(path);
    },
    size: () => entries.size,
  };
}
