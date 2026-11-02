"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Printer } from "lucide-react";
import { createStudents, type CreateStudentsResult } from "../../actions";
import { FieldError, FormError } from "@/components/platform/FormError";
import { SubmitButton } from "@/components/platform/SubmitButton";
import { Card, Notice, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";
import { ageBandLabels } from "@/lib/platform/messages";

const subscribe = () => () => {};

/** Адрес входа для карточек: тот сайт, на котором открыт кабинет. */
function useLoginUrl(): string {
  return useSyncExternalStore(
    subscribe,
    () => `${window.location.host}/login`,
    () => "/login",
  );
}

export function CreateStudents({ groupId, groupCode }: { groupId: string; groupCode: string }) {
  const [state, action] = useActionState<CreateStudentsResult | null, FormData>(createStudents, null);
  const loginUrl = useLoginUrl();
  const created = state?.ok ? state.created : [];

  return (
    <>
      <Card
        title="Добавить учеников"
        description="Ники, не настоящие имена. По одному в строке. Логин получится такой: код группы и ник латиницей."
        className="print:hidden"
      >
        <form action={action} className="space-y-5">
          <input type="hidden" name="groupId" value={groupId} />
          <div>
            <label htmlFor="nicknames" className={labelClass}>
              Ники
            </label>
            <textarea
              id="nicknames"
              name="nicknames"
              rows={6}
              required
              maxLength={4000}
              placeholder={"Лиза\nМакс\nОля"}
              className={`${inputClass} mt-2 font-mono`}
            />
            <p className={hintClass}>
              Например, «Лиза» → <span className="font-mono">{groupCode}-liza</span>. До 40 за раз. Каждому — 1000 ★.
            </p>
            <FieldError state={state} name="nicknames" />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="ageBand" className={labelClass}>
                Возраст для всей пачки
              </label>
              <select id="ageBand" name="ageBand" defaultValue="u16" className={`${inputClass} mt-2`}>
                {Object.entries(ageBandLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className={hintClass}>Потом можно поменять каждому отдельно.</p>
            </div>
            <label className="flex items-start gap-3 self-center">
              <input type="checkbox" name="consent" className="mt-1 size-5 accent-violet" />
              <span>
                Согласие родителей получено
                <span className={`${hintClass} block`}>Отметьте, только если у вас есть письменные согласия.</span>
              </span>
            </label>
          </div>
          <FormError state={state} />
          <SubmitButton pendingText="Создаём аккаунты…">Создать</SubmitButton>
        </form>
      </Card>

      {state?.ok && (
        <section aria-labelledby="created-title" className="rounded-3xl bg-sun/30 p-5 ring-1 ring-sun sm:p-6 print:bg-white print:p-0 print:ring-0">
          <div className="print:hidden">
            <h2 id="created-title" className="text-lg font-semibold sm:text-xl">
              Создано: {created.length}
            </h2>
            <Notice tone="warn" className="mt-3">
              Пароли показываются один раз. Распечатайте карточки или перепишите сейчас: после ухода со страницы их
              не будет. Забытый пароль можно сбросить.
            </Notice>
            {state.failed.length > 0 && (
              <Notice tone="error" className="mt-3">
                Не удалось создать: {state.failed.join(", ")}. Попробуйте ещё раз.
              </Notice>
            )}
            {created.length > 0 && (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="font-mono text-xs text-ink-soft">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Ник</th>
                        <th className="py-2 pr-4 font-medium">Логин</th>
                        <th className="py-2 font-medium">Пароль</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/10">
                      {created.map((s) => (
                        <tr key={s.login}>
                          <td className="py-2 pr-4">{s.nickname}</td>
                          <td className="py-2 pr-4 font-mono whitespace-nowrap">{s.login}</td>
                          <td className="py-2 font-mono whitespace-nowrap">{s.password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => window.print()} className={`${buttonClass("secondary")} mt-4`}>
                  <Printer aria-hidden="true" className="size-5" /> Печать карточек
                </button>
              </>
            )}
          </div>

          {/* Вид для печати: только карточки, по линии отреза */}
          <ul className="hidden grid-cols-2 gap-3 print:grid">
            {created.map((s) => (
              <li key={s.login} className="break-inside-avoid rounded-xl border-2 border-dashed border-ink/40 p-4">
                <p className="font-display text-sm font-semibold">ИИ-старт · кабинет</p>
                <p className="font-mono text-xs">{loginUrl}</p>
                <p className="mt-3 text-xs">Логин</p>
                <p className="font-mono text-lg font-semibold">{s.login}</p>
                <p className="mt-2 text-xs">Пароль</p>
                <p className="font-mono text-lg font-semibold">{s.password}</p>
                <p className="mt-3 text-xs">{s.nickname}. Никому не показывайте пароль.</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
