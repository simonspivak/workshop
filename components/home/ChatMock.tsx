import { Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

/**
 * Мокап переписки с ИИ на первом экране — вместо картинки.
 * Сообщения появляются по очереди (без анимации при «уменьшить движение»).
 */
export function ChatMock({
  chat,
}: {
  chat: { title: string; status: string; messages: ChatMessage[] };
}) {
  return (
    <figure
      aria-label={chat.title}
      className="rounded-[2rem] bg-white p-4 ring-1 ring-ink/10 sm:p-5"
    >
      <figcaption className="flex items-center gap-3 border-b border-ink/10 pb-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-violet text-white">
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
        <span>
          <span className="block font-semibold">{chat.title}</span>
          <span className="flex items-center gap-1.5 font-mono text-xs text-ink-soft">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#22c55e]" />
            {chat.status}
          </span>
        </span>
      </figcaption>

      <ol className="mt-4 space-y-3">
        {chat.messages.map((message, i) => {
          const mine = message.from === "me";
          return (
            <li
              key={message.text}
              className={`pop-in flex flex-col ${mine ? "items-end" : "items-start"}`}
              style={{ animationDelay: `${300 + i * 650}ms` }}
            >
              <p
                className={`max-w-[85%] rounded-3xl px-4 py-2.5 leading-snug ${
                  mine ? "rounded-br-md bg-violet text-white" : "rounded-bl-md bg-lavender"
                }`}
              >
                {message.text}
              </p>
              {message.chips && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {message.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-xl bg-paper px-3 py-1.5 font-mono text-xs ring-1 ring-ink/10"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
