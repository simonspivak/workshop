import "server-only";
import type { BrainResult, LeadOutcome } from "@/lib/server/bot/brain";
import { signCardTicket } from "@/lib/server/bot/secrets";

/*
  Ответ чата для браузера (веб-чат и проверка в конструкторе). Предложение открытки
  превращается в подписанный билет: без него сервер открытку не нарисует.
*/

export type ChatReply =
  | {
      ok: true;
      status: BrainResult["status"];
      text: string;
      lead: LeadOutcome;
      card: { ticket: string; scene: string; stars: number } | null;
    }
  | { ok: false; error: string; message: string };

export type CardStartReply = { ok: true; jobId: string; stars: number } | { ok: false; error: string; message: string };

export type CardPollReply =
  | { ok: true; status: "pending" | "failed" }
  | { ok: true; status: "done"; url: string }
  | { ok: false; error: string; message: string };

export function toChatReply(result: BrainResult, context: { botId: string; conversationId: string }): ChatReply {
  if (result.status !== "ok") return { ok: true, status: result.status, text: result.text, lead: null, card: null };
  return {
    ok: true,
    status: "ok",
    text: result.text,
    lead: result.lead,
    card: result.card
      ? {
          ticket: signCardTicket({ botId: context.botId, conversationId: context.conversationId, scene: result.card.scene }),
          scene: result.card.scene,
          stars: result.card.stars,
        }
      : null,
  };
}
