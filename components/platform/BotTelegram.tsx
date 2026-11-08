"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import type { BotActionResult } from "@/lib/server/bot/errors";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Notice, hintClass, inputClass, labelClass } from "@/components/platform/ui";

type Action = (prev: BotActionResult | null, formData: FormData) => Promise<BotActionResult>;

/*
  Telegram для бота (только 18+ и ведущие). Токен — поле только для записи: после подключения
  он хранится зашифрованным на сервере и в браузер больше не возвращается.
*/
export function BotTelegram({
  allowed,
  telegram,
  connectAction,
  disconnectAction,
}: {
  allowed: boolean;
  telegram: { connected: boolean; username: string | null; ownerLinked: boolean; ownerLink: string | null };
  connectAction: Action;
  disconnectAction: Action;
}) {
  const [connectState, connect] = useActionState<BotActionResult | null, FormData>(connectAction, null);
  const [disconnectState, disconnect] = useActionState<BotActionResult | null, FormData>(disconnectAction, null);

  if (!allowed) {
    return (
      <p className="text-ink-soft">
        Telegram — с 18 лет. Ваш бот работает на своей странице: ссылку можно открыть с телефона и отправить друзьям.
      </p>
    );
  }

  if (telegram.connected && telegram.username) {
    return (
      <div className="space-y-4">
        <p>
          Подключён{" "}
          <a
            href={`https://t.me/${telegram.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-violet underline underline-offset-4"
          >
            @{telegram.username} <ExternalLink aria-hidden="true" className="size-4" />
          </a>
          . Характер и инструменты те же, что на странице бота. Открыток в Telegram нет: бот отправит на свою страницу.
        </p>
        {telegram.ownerLinked ? (
          <Notice tone="success">Уведомления о заявках приходят вам в этот чат.</Notice>
        ) : (
          telegram.ownerLink && (
            <Notice>
              Чтобы получать уведомления о заявках, откройте{" "}
              <a href={telegram.ownerLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet underline underline-offset-4">
                эту ссылку
              </a>{" "}
              в Telegram и нажмите «Start». Ссылку никому не пересылайте.
            </Notice>
          )
        )}
        <form action={disconnect} className="space-y-2">
          {disconnectState && !disconnectState.ok && <Notice tone="error">{disconnectState.message}</Notice>}
          <SubmitButton variant="danger" size="sm" pendingText="Отключаем…">
            Отключить Telegram
          </SubmitButton>
          <p className={hintClass}>Вебхук снимется, токен сотрётся с сервера. Сам бот в Telegram останется вашим.</p>
        </form>
      </div>
    );
  }

  return (
    <form action={connect} className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
        <li>В Telegram откройте @BotFather (с синей галочкой) → /newbot.</li>
        <li>Придумайте имя и username, который заканчивается на bot.</li>
        <li>Скопируйте токен и вставьте сюда. Больше никуда: ни в чат, ни на скриншот.</li>
      </ol>
      <div>
        <label htmlFor="tg-token" className={labelClass}>
          Токен от @BotFather
        </label>
        <input
          id="tg-token"
          name="token"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="123456789:AA…"
          className={`${inputClass} mt-2 font-mono`}
        />
        <p className={hintClass}>После подключения токен хранится зашифрованным на сервере. Показать его снова нельзя.</p>
      </div>
      {connectState && !connectState.ok && <Notice tone="error">{connectState.message}</Notice>}
      <SubmitButton pendingText="Проверяем токен…">Подключить</SubmitButton>
    </form>
  );
}
