import "server-only";

/*
  Единственный модуль, который ходит в Telegram Bot API. У каждого вызова таймаут.
  Токен — часть адреса запроса, поэтому ни адрес, ни объект ошибки fetch в логи не пишем:
  только имя метода, HTTP-статус и error_code Telegram.
*/

const API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Формат токена от @BotFather: <id бота>:<секрет>. */
export const TELEGRAM_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

export type TelegramError = "unauthorized" | "bad_request" | "rate_limited" | "timeout" | "network" | "server";

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; error: TelegramError; status?: number };

async function call<T>(token: string, method: string, payload: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TelegramResult<T>> {
  if (!TELEGRAM_TOKEN_RE.test(token)) return { ok: false, error: "unauthorized" };
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(`telegram.${method}: request failed`, { reason: timedOut ? "timeout" : "network" });
    return { ok: false, error: timedOut ? "timeout" : "network" };
  }

  type Body = { ok?: boolean; result?: T; error_code?: number };
  let body: Body | null = null;
  try {
    body = (await response.json()) as Body;
  } catch {
    body = null;
  }
  if (response.ok && body?.ok === true) return { ok: true, result: body.result as T };

  const status = response.status;
  console.error(`telegram.${method}: api error`, { status, code: body?.error_code ?? null });
  if (status === 401 || status === 404) return { ok: false, error: "unauthorized", status };
  if (status === 429) return { ok: false, error: "rate_limited", status };
  if (status >= 500) return { ok: false, error: "server", status };
  return { ok: false, error: "bad_request", status };
}

export type TelegramBotInfo = { id: number; is_bot: boolean; username?: string; first_name?: string };

/** Проверить токен: кто этот бот. */
export function getMe(token: string): Promise<TelegramResult<TelegramBotInfo>> {
  return call<TelegramBotInfo>(token, "getMe", {});
}

/** Вебхук: только сообщения, свой secret_token, старые обновления сбрасываем. */
export function setWebhook(token: string, input: { url: string; secretToken: string }): Promise<TelegramResult<boolean>> {
  return call<boolean>(token, "setWebhook", {
    url: input.url,
    secret_token: input.secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    max_connections: 10,
  });
}

export function deleteWebhook(token: string): Promise<TelegramResult<boolean>> {
  return call<boolean>(token, "deleteWebhook", { drop_pending_updates: true });
}

/** Простой текст, без parse_mode и превью ссылок. Telegram принимает до 4096 символов. */
export function sendMessage(token: string, chatId: number, text: string): Promise<TelegramResult<unknown>> {
  const safe = text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
  return call(token, "sendMessage", {
    chat_id: chatId,
    text: safe || "…",
    link_preview_options: { is_disabled: true },
  });
}

/** «Печатает…» — пока бот думает. Ошибку можно игнорировать. */
export function sendTyping(token: string, chatId: number): Promise<TelegramResult<unknown>> {
  return call(token, "sendChatAction", { chat_id: chatId, action: "typing" }, 3_000);
}

// ---------- входящее обновление ----------

export type TelegramMessage = {
  updateId: number;
  chatId: number;
  chatType: string;
  fromIsBot: boolean;
  text: string | null;
};

/** Достать из обновления то, что нужно боту. null — не сообщение (или битое). */
export function readUpdate(body: unknown): TelegramMessage | null {
  if (!body || typeof body !== "object") return null;
  const update = body as Record<string, unknown>;
  const updateId = update.update_id;
  const message = update.message as Record<string, unknown> | undefined;
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId) || !message || typeof message !== "object") return null;
  const chat = message.chat as Record<string, unknown> | undefined;
  const from = message.from as Record<string, unknown> | undefined;
  if (!chat || typeof chat.id !== "number" || !Number.isSafeInteger(chat.id)) return null;
  return {
    updateId,
    chatId: chat.id,
    chatType: typeof chat.type === "string" ? chat.type : "unknown",
    fromIsBot: from?.is_bot === true,
    text: typeof message.text === "string" ? message.text : null,
  };
}

/** /start, /start payload, /help@bot_name → { command, payload }. */
export function readCommand(text: string): { command: string; payload: string } | null {
  const match = /^\/([a-z0-9_]{1,32})(?:@[A-Za-z0-9_]{3,64})?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), payload: (match[2] ?? "").trim() };
}
