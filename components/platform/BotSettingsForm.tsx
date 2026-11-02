"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BotActionResult } from "@/lib/server/bot/errors";
import type { BotTools, LeadFieldType, LeadForm } from "@/lib/server/bot/tools";
import { Notice, buttonClass, hintClass, inputClass, labelClass } from "@/components/platform/ui";

/*
  Конструктор бота: имя, адрес, душа, инструменты (заявки с полями, открытка, «мой текст») и аватар.
  Отправка вручную (onSubmit + startTransition), а не через <form action>: так поля не сбрасываются,
  если сервер вернул ошибку.
*/

export type BotSettingsValue = {
  name: string;
  slug: string;
  soul: string;
  knowledge: string;
  tools: BotTools;
  avatarJobId: string | null;
};

export type BotSettingsLimits = { nameMax: number; soulMax: number; knowledgeMax: number };

type GalleryImage = { jobId: string; url: string; label: string };

type EditableField = { key: string; label: string; type: LeadFieldType; required: boolean; options: string };

const FIELD_TYPE_LABELS: Record<LeadFieldType, string> = {
  name: "Имя или ник",
  number: "Число",
  choice: "Выбор из вариантов",
  text: "Короткий текст, до 200 знаков",
  contact: "Контакт (телефон, e-mail или ник)",
};

const FIELDS_MAX = 4;

const SOUL_TEMPLATE = `ДУША БОТА v1
Кто ты: (2 предложения от первого лица: кто ты в сериале «На масле»; обязательно «я ИИ-персонаж»)
Как говоришь: (манера, длина ответа — до 3 предложений, 3 фирменные фразы, эмодзи да/нет)
Чем полезен: (одна главная польза)
Чего никогда не делаешь: (табу из паспорта + правила темы + правила курса)
Приветствие: (до 25 слов: кто ты, что ты ИИ, что умеешь)
Кнопки: (3 штуки, до 3 слов каждая, через «·»)
Инструменты: (Заявка — что принимаешь; Открытка — когда предлагать; Ответы по моему тексту — на какие вопросы)`;

// Ключи полей: у исходных — по номеру (одинаковые на сервере и в браузере), у новых — по счётчику
let keySeed = 0;
const nextKey = () => `new-${(keySeed++).toString(36)}`;

function toEditable(form: LeadForm | null): EditableField[] {
  return (form?.fields ?? []).map((f, index) => ({
    key: `field-${index}`,
    label: f.label,
    type: f.type,
    required: f.required,
    options: (f.options ?? []).join(", "),
  }));
}

function serializeForm(title: string, fields: EditableField[]): string {
  if (!fields.length) return "";
  return JSON.stringify({
    title: title.trim() || "Заявка",
    fields: fields.map((f) => ({
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      ...(f.type === "choice"
        ? { options: f.options.split(/[,;\n]/).map((o) => o.trim()).filter(Boolean) }
        : {}),
    })),
  });
}

export function BotSettingsForm({
  bot,
  limits,
  images,
  adult,
  prices,
  guestCards,
  saveAction,
}: {
  bot: BotSettingsValue;
  limits: BotSettingsLimits;
  images: GalleryImage[];
  adult: boolean;
  prices: { reply: number; card: number | null };
  guestCards: boolean;
  saveAction: (prev: BotActionResult | null, formData: FormData) => Promise<BotActionResult>;
}) {
  const [state, setState] = useState<BotActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [soul, setSoul] = useState(bot.soul);
  const [knowledge, setKnowledge] = useState(bot.knowledge);
  const [useKnowledge, setUseKnowledge] = useState(bot.tools.knowledge);
  const [useLeads, setUseLeads] = useState(bot.tools.leads);
  const [useImage, setUseImage] = useState(bot.tools.image);
  const [formTitle, setFormTitle] = useState(bot.tools.leadForm?.title ?? "Заявка");
  const [fields, setFields] = useState<EditableField[]>(() => toEditable(bot.tools.leadForm));
  const [avatar, setAvatar] = useState(bot.avatarJobId ?? "");

  const fieldTypes = (Object.keys(FIELD_TYPE_LABELS) as LeadFieldType[]).filter((t) => t !== "contact" || adult);
  const errors = state && !state.ok ? (state.fields ?? {}) : {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => setState(await saveAction(null, formData)));
  }

  function toggleLeads(checked: boolean) {
    setUseLeads(checked);
    if (checked && fields.length === 0) {
      setFields([{ key: nextKey(), label: "Имя", type: "name", required: true, options: "" }]);
    }
  }

  const patchField = (key: string, patch: Partial<EditableField>) =>
    setFields((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      <input type="hidden" name="leadForm" value={serializeForm(formTitle, fields)} />

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2" aria-labelledby="bot-basics">
        <h2 id="bot-basics" className="sr-only">
          Имя и адрес
        </h2>
        <div>
          <label htmlFor="bot-name" className={labelClass}>
            Имя бота
          </label>
          <input id="bot-name" name="name" required maxLength={limits.nameMax} defaultValue={bot.name} className={`${inputClass} mt-2`} />
          <FieldError message={errors.name} />
        </div>
        <div>
          <label htmlFor="bot-slug" className={labelClass}>
            Адрес страницы
          </label>
          <div className="mt-2 flex items-center rounded-2xl border border-ink/15 bg-white focus-within:border-violet">
            <span className="pl-4 font-mono text-sm text-ink-soft">/b/</span>
            <input
              id="bot-slug"
              name="slug"
              defaultValue={bot.slug}
              maxLength={40}
              pattern="[a-z0-9-]{3,40}"
              autoCapitalize="off"
              spellCheck={false}
              className="min-h-12 w-full rounded-r-2xl bg-transparent py-3 pr-4 pl-1 font-mono text-base focus-visible:outline-none"
            />
          </div>
          <p className={hintClass}>Латиница, цифры и дефисы. Если поменять, старая ссылка перестанет работать.</p>
          <FieldError message={errors.slug} />
        </div>
      </section>

      <section aria-labelledby="bot-soul">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label id="bot-soul" htmlFor="bot-soul-text" className="font-display text-lg font-semibold">
            Душа
          </label>
          <span className="font-mono text-xs text-ink-soft">
            {soul.length} / {limits.soulMax}
          </span>
        </div>
        <p className={hintClass}>
          Кто бот, как говорит, чем полезен, чего никогда не делает. Строки «Приветствие:» и «Кнопки:» платформа покажет
          гостям в начале чата. Над душой всегда стоят правила платформы: их не видно и их нельзя отменить.
        </p>
        <textarea
          id="bot-soul-text"
          name="soul"
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          maxLength={limits.soulMax}
          rows={12}
          className={`${inputClass} mt-3 font-mono text-sm leading-relaxed`}
          placeholder="ДУША БОТА v1&#10;Кто ты: …"
        />
        {!soul.trim() && (
          <button type="button" onClick={() => setSoul(SOUL_TEMPLATE)} className={`${buttonClass("secondary", "sm")} mt-2`}>
            Вставить шаблон души
          </button>
        )}
        <FieldError message={errors.soul} />
      </section>

      <section aria-labelledby="bot-tools" className="space-y-4">
        <h2 id="bot-tools" className="text-lg font-semibold">
          Инструменты
        </h2>

        <ToolBox
          name="toolKnowledge"
          checked={useKnowledge}
          onChange={setUseKnowledge}
          title="Ответы по моему тексту"
          text="Бот отвечает о фактах только по этому тексту. Чего здесь нет — честно говорит «не знаю»."
        >
          <div className="flex justify-end">
            <span className="font-mono text-xs text-ink-soft">
              {knowledge.length} / {limits.knowledgeMax}
            </span>
          </div>
          <label htmlFor="bot-knowledge" className="sr-only">
            Мой текст
          </label>
          <textarea
            id="bot-knowledge"
            name="knowledge"
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
            maxLength={limits.knowledgeMax}
            rows={8}
            className={`${inputClass} mt-1 text-sm leading-relaxed`}
            placeholder="МОЙ ТЕКСТ — проверенные факты: о блюде, о празднике, о вечере (дата, место, программа)…"
          />
          <FieldError message={errors.knowledge} />
        </ToolBox>
        {!useKnowledge && <input type="hidden" name="knowledge" value={knowledge} />}

        <ToolBox
          name="toolLeads"
          checked={useLeads}
          onChange={toggleLeads}
          title="Заявки"
          text="Бот собирает поля в разговоре, переспрашивает «Всё верно?» и после «да» сохраняет заявку. Прочитать заявки бот не может: их видите только вы и ведущий."
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="lead-title" className={labelClass}>
                Название формы
              </label>
              <input
                id="lead-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={60}
                className={`${inputClass} mt-2`}
                placeholder="Запись на ханукальный вечер"
              />
            </div>
            <ol className="space-y-3">
              {fields.map((field, index) => (
                <li key={field.key} className="rounded-2xl bg-paper p-3 ring-1 ring-ink/10">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div>
                      <label htmlFor={`${field.key}-label`} className="text-sm font-medium">
                        Поле {index + 1}
                      </label>
                      <input
                        id={`${field.key}-label`}
                        value={field.label}
                        onChange={(e) => patchField(field.key, { label: e.target.value })}
                        maxLength={40}
                        className={`${inputClass} mt-1`}
                        placeholder="Например: Сколько человек"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${field.key}-type`} className="text-sm font-medium">
                        Что это
                      </label>
                      <select
                        id={`${field.key}-type`}
                        value={field.type}
                        onChange={(e) => patchField(field.key, { type: e.target.value as LeadFieldType })}
                        className={`${inputClass} mt-1`}
                      >
                        {fieldTypes.map((type) => (
                          <option key={type} value={type}>
                            {FIELD_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFields((list) => list.filter((f) => f.key !== field.key))}
                      className="inline-flex size-12 items-center justify-center self-end rounded-full text-coral-deep hover:bg-coral/15"
                      aria-label={`Удалить поле ${index + 1}`}
                    >
                      <Trash2 aria-hidden="true" className="size-5" />
                    </button>
                  </div>
                  {field.type === "choice" && (
                    <div className="mt-3">
                      <label htmlFor={`${field.key}-options`} className="text-sm font-medium">
                        Варианты через запятую (2–5)
                      </label>
                      <input
                        id={`${field.key}-options`}
                        value={field.options}
                        onChange={(e) => patchField(field.key, { options: e.target.value })}
                        className={`${inputClass} mt-1`}
                        placeholder="клубничный, вишнёвый, без джема"
                      />
                    </div>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => patchField(field.key, { required: e.target.checked })}
                      className="size-5 accent-violet"
                    />
                    Обязательное поле
                  </label>
                </li>
              ))}
            </ol>
            {fields.length < FIELDS_MAX && (
              <button
                type="button"
                onClick={() => setFields((list) => [...list, { key: nextKey(), label: "", type: "text", required: true, options: "" }])}
                className={buttonClass("secondary", "sm")}
              >
                <Plus aria-hidden="true" className="size-4" /> Добавить поле
              </button>
            )}
            {!adult && (
              <p className={hintClass}>
                Поля «Контакт» нет: у ботов участников младше 18 контакты не собираются. Ник и ответы — можно.
              </p>
            )}
            <FieldError message={errors.leadForm} />
          </div>
        </ToolBox>

        <ToolBox
          name="toolImage"
          checked={useImage}
          onChange={setUseImage}
          title="Открытка"
          text={`Бот рисует открытку с собой по сцене гостя. Сначала он спрашивает «Нарисовать?», потом платформа показывает кнопку с ценой. Тратит ваши звёзды${prices.card !== null ? `: ${prices.card} ★ за открытку` : ""}.`}
        >
          {guestCards ? (
            <p className={hintClass}>Гостям на странице — не больше 3 открыток в сутки.</p>
          ) : (
            <p className={hintClass}>Гостям открытки не рисуются (только с 18 лет). В вашей проверке справа — работают.</p>
          )}
          {!bot.avatarJobId && !avatar && (
            <p className={hintClass}>Без аватара бот нарисует героя только по имени. С аватаром — похожим на себя.</p>
          )}
        </ToolBox>
      </section>

      <section aria-labelledby="bot-avatar">
        <h2 id="bot-avatar" className="text-lg font-semibold">
          Аватар
        </h2>
        <p className={hintClass}>Картинка из вашей галереи: портрет героя или кадр из листа персонажа.</p>
        {images.length === 0 ? (
          <Notice className="mt-3">В галерее пока нет картинок. Сделайте портрет героя, и он появится здесь.</Notice>
        ) : (
          <fieldset className="mt-3">
            <legend className="sr-only">Выберите аватар</legend>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <label className={avatarTileClass(avatar === "")}>
                <input type="radio" name="avatarJobId" value="" checked={avatar === ""} onChange={() => setAvatar("")} className="sr-only" />
                <span className="flex aspect-square items-center justify-center rounded-xl bg-lavender text-center text-xs text-ink-soft">
                  Без аватара
                </span>
              </label>
              {images.map((image) => (
                <label key={image.jobId} className={avatarTileClass(avatar === image.jobId)} title={image.label}>
                  <input
                    type="radio"
                    name="avatarJobId"
                    value={image.jobId}
                    checked={avatar === image.jobId}
                    onChange={() => setAvatar(image.jobId)}
                    className="sr-only"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={image.label || "Картинка из галереи"} className="aspect-square w-full rounded-xl object-cover" />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {images.length === 0 && <input type="hidden" name="avatarJobId" value="" />}
        <FieldError message={errors.avatarJobId} />
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-full bg-paper/90 py-2 backdrop-blur">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <span role="status" className="text-sm">
          {state?.ok && !pending && "Сохранено. Проверка уже отвечает по новым настройкам."}
          {state && !state.ok && !pending && <span className="text-coral-deep">{state.message}</span>}
        </span>
        <span className="ml-auto pr-4 font-mono text-xs text-ink-soft">ответ бота — {prices.reply}&nbsp;★</span>
      </div>
    </form>
  );
}

function avatarTileClass(selected: boolean): string {
  return `block cursor-pointer rounded-2xl p-1 ring-2 transition-colors focus-within:ring-violet ${
    selected ? "ring-violet" : "ring-transparent hover:ring-ink/15"
  }`;
}

function ToolBox({
  name,
  checked,
  onChange,
  title,
  text,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-3xl p-4 ring-1 transition-colors sm:p-5 ${checked ? "bg-white ring-violet/40" : "bg-paper ring-ink/10"}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-violet"
        />
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-sm text-ink-soft">{text}</span>
        </span>
      </label>
      {checked && children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-coral-deep">{message}</p>;
}
