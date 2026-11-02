"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageIcon, RotateCcw, SendHorizontal } from "lucide-react";
import type { CardPollReply, CardStartReply, ChatReply } from "@/lib/server/bot/chat";
import type { BotActionResult } from "@/lib/server/bot/errors";
import { buttonClass } from "@/components/platform/ui";

/*
  Чат с ботом. Один компонент для публичной страницы /b/[slug] (fetch в /api/b/[slug])
  и для проверки в конструкторе (Server Actions владельца — те же мозг и звёзды).
*/

export type BotChatMessage = { id: string; role: "user" | "assistant"; text: string };

type CardState =
  | { state: "offer"; ticket: string; scene: string; stars: number }
  | { state: "starting" | "pending"; scene: string; stars: number; jobId?: string; since?: number }
  | { state: "done"; scene: string; url: string }
  | { state: "failed"; scene: string; message: string };

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
  lead?: "saved" | "invalid" | "limit" | null;
  card?: CardState;
};

const MAX_LENGTH = 1000;
const POLL_MS = 3_000;
const POLL_LIMIT_MS = 3 * 60_000;

export function BotChat({
  slug,
  botName,
  avatarUrl,
  greeting,
  buttons,
  initialMessages,
  mode,
  sendAction,
  startCardAction,
  resetAction,
  className = "",
}: {
  slug: string;
  botName: string;
  avatarUrl: string | null;
  greeting: string;
  buttons: string[];
  initialMessages: BotChatMessage[];
  mode: "public" | "preview";
  sendAction?: (input: { text: string; messageId: string }) => Promise<ChatReply>;
  startCardAction?: (input: { ticket: string }) => Promise<CardStartReply>;
  resetAction?: () => Promise<BotActionResult>;
  className?: string;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(() => initialMessages.map((m) => ({ ...m })));
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, pending]);

  const update = (id: string, patch: (m: UiMessage) => UiMessage) =>
    setMessages((list) => list.map((m) => (m.id === id ? patch(m) : m)));

  async function send(text: string): Promise<ChatReply> {
    const messageId = crypto.randomUUID();
    if (sendAction) return sendAction({ text, messageId });
    try {
      const response = await fetch(`/api/b/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "message", text, messageId }),
      });
      return (await response.json()) as ChatReply;
    } catch {
      return { ok: false, error: "network", message: "Нет связи. Проверьте интернет и попробуйте ещё раз." };
    }
  }

  function submit(raw: string) {
    const text = raw.trim().slice(0, MAX_LENGTH);
    if (!text || pending) return;
    setDraft("");
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((list) => [...list, userMessage]);
    startTransition(async () => {
      const reply = await send(text);
      const next: UiMessage = !reply.ok
        ? { id: crypto.randomUUID(), role: "notice", text: reply.message }
        : reply.status === "duplicate"
          ? { id: crypto.randomUUID(), role: "notice", text: "Это сообщение уже отправлено." }
          : reply.status === "ok"
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                text: reply.text,
                lead: reply.lead,
                card: reply.card ? { state: "offer", ...reply.card } : undefined,
              }
            : { id: crypto.randomUUID(), role: "notice", text: reply.text };
      setMessages((list) => [...list, next]);
      inputRef.current?.focus();
    });
  }

  async function confirmCard(message: UiMessage) {
    if (message.card?.state !== "offer") return;
    const { ticket, scene, stars } = message.card;
    update(message.id, (m) => ({ ...m, card: { state: "starting", scene, stars } }));
    let result: CardStartReply;
    if (startCardAction) {
      result = await startCardAction({ ticket });
    } else {
      try {
        const response = await fetch(`/api/b/${slug}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "card", ticket }),
        });
        result = (await response.json()) as CardStartReply;
      } catch {
        result = { ok: false, error: "network", message: "Нет связи. Попробуйте ещё раз." };
      }
    }
    update(message.id, (m) => ({
      ...m,
      card: result.ok
        ? { state: "pending", scene, stars, jobId: result.jobId, since: Date.now() }
        : { state: "failed", scene, message: result.message },
    }));
  }

  // Опрос открыток, которые рисуются
  const pendingCards = messages.filter((m) => m.card?.state === "pending");
  const pendingKey = pendingCards.map((m) => m.id).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = window.setInterval(async () => {
      for (const message of pendingCards) {
        const card = message.card;
        if (card?.state !== "pending" || !card.jobId) continue;
        if (Date.now() - (card.since ?? 0) > POLL_LIMIT_MS) {
          update(message.id, (m) => ({
            ...m,
            card: { state: "failed", scene: card.scene, message: "Рисуется дольше обычного. Загляните позже в галерею владельца." },
          }));
          continue;
        }
        try {
          const response = await fetch(`/api/b/${slug}/card?id=${card.jobId}`, { cache: "no-store" });
          const status = (await response.json()) as CardPollReply;
          if (!status.ok) {
            update(message.id, (m) => ({ ...m, card: { state: "failed", scene: card.scene, message: status.message } }));
          } else if (status.status === "done") {
            update(message.id, (m) => ({ ...m, card: { state: "done", scene: card.scene, url: status.url } }));
          } else if (status.status === "failed") {
            update(message.id, (m) => ({
              ...m,
              card: { state: "failed", scene: card.scene, message: "Не получилось нарисовать. Звёзды вернулись." },
            }));
          }
        } catch {
          // сеть моргнула — спросим в следующий раз
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // pendingCards меняется вместе с pendingKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, slug]);

  function reset() {
    if (!resetAction) return;
    startTransition(async () => {
      const result = await resetAction();
      if (result.ok) setMessages([]);
      else setMessages((list) => [...list, { id: crypto.randomUUID(), role: "notice", text: result.message }]);
    });
  }

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-ink/10 ${className}`}>
      <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3">
        <Avatar url={avatarUrl} name={botName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold">{botName}</p>
          <p className="font-mono text-xs text-ink-soft">{mode === "preview" ? "проверка · ваши звёзды" : "ИИ-персонаж"}</p>
        </div>
        {resetAction && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-soft hover:bg-lavender disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="size-4" /> Заново
          </button>
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={`Переписка с ботом ${botName}`}
        className="min-h-64 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        <Bubble role="assistant" text={greeting} />
        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <Bubble role={message.role} text={message.text} />
            {message.lead === "saved" && (
              <p className="ml-1 font-mono text-xs text-violet-deep">✓ Заявка сохранена: её увидит владелец бота</p>
            )}
            {message.card && <CardView card={message.card} onConfirm={() => confirmCard(message)} mode={mode} />}
          </div>
        ))}
        {pending && <TypingDots />}
      </div>

      {buttons.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {buttons.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => submit(label)}
              disabled={pending}
              className="shrink-0 rounded-full bg-lavender px-3 py-1.5 text-sm font-medium hover:bg-glow disabled:opacity-60"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t border-ink/10 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <label htmlFor={`bot-input-${mode}`} className="sr-only">
          Сообщение боту
        </label>
        <textarea
          id={`bot-input-${mode}`}
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit(draft);
            }
          }}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Напишите сообщение…"
          autoComplete="off"
          className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base placeholder:text-ink-soft/70 focus-visible:border-violet"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-violet text-white hover:bg-violet-deep disabled:opacity-50"
          aria-label="Отправить"
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // Подписанная ссылка Storage на час: next/image здесь не нужен
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover ring-2 ring-violet/20" />;
  }
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-violet font-display text-sm font-semibold text-white">
      {name.trim().charAt(0).toUpperCase() || "Б"}
    </span>
  );
}

function Bubble({ role, text }: { role: UiMessage["role"]; text: string }) {
  if (role === "notice") {
    return <p className="mx-auto max-w-[90%] rounded-2xl bg-sun/40 px-3 py-2 text-center text-sm">{text}</p>;
  }
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-line break-words ${
          mine ? "rounded-br-lg bg-violet text-white" : "rounded-bl-lg bg-lavender text-ink"
        }`}
      >
        <span className="sr-only">{mine ? "Вы: " : "Бот: "}</span>
        {text}
      </p>
    </div>
  );
}

function CardView({ card, onConfirm, mode }: { card: CardState; onConfirm: () => void; mode: "public" | "preview" }) {
  if (card.state === "offer") {
    return (
      <div className="ml-1 rounded-2xl bg-paper p-3 ring-1 ring-ink/10">
        <p className="text-sm text-ink-soft">Открытка: {card.scene}</p>
        <button type="button" onClick={onConfirm} className={`${buttonClass("sun", "sm")} mt-2`}>
          <ImageIcon aria-hidden="true" className="size-4" />
          Нарисовать · {card.stars}&nbsp;★{mode === "public" ? " владельца" : ""}
        </button>
      </div>
    );
  }
  if (card.state === "starting" || card.state === "pending") {
    return (
      <p className="ml-1 animate-pulse rounded-2xl bg-paper p-3 text-sm text-ink-soft ring-1 ring-ink/10">
        Рисую открытку, это 15–30 секунд…
      </p>
    );
  }
  if (card.state === "failed") {
    return <p className="ml-1 rounded-2xl bg-coral/15 p-3 text-sm text-coral-deep">{card.message}</p>;
  }
  if (card.state !== "done") return null;
  return (
    <figure className="ml-1 max-w-64">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={card.url} alt={`Открытка: ${card.scene}`} className="w-full rounded-2xl ring-1 ring-ink/10" />
      <figcaption className="mt-1 text-xs text-ink-soft">
        <a href={card.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          Открыть целиком
        </a>{" "}
        · ссылка работает час
      </figcaption>
    </figure>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-start" aria-label="Бот печатает">
      <span className="inline-flex gap-1 rounded-3xl rounded-bl-lg bg-lavender px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-2 animate-bounce rounded-full bg-ink-soft/60"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
