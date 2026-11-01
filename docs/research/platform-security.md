# Образовательная платформа: архитектура, безопасность, право и деньги

Дата: 01.11.2026. Автор: исследовательский агент для Сени Спивака.
Связанный отчёт: [`docs/research/kie-models.md`](./kie-models.md) — модели kie.ai, цены, экономика звёзд, вебхуки kie.

## Как собраны данные и насколько им верить

- **Next.js 16.4.3** — документация из `node_modules/next/dist/docs/` этого репозитория (та версия, что стоит в проекте). Пометка **[Next-доки]**.
- **Supabase** — официальная документация и прайс-данные, прочитанные напрямую из исходников сайта supabase.com (репозиторий `supabase/supabase`, ветка master, коммит `a05e7ec`, 01.11.2026). Пометка **[офиц.]**.
- **Vercel, Firebase, Clerk, Convex, Neon, GitHub, право.** Сайты vercel.com, firebase.google.com, kie.ai из этой среды не открываются (DNS заблокирован). Поэтому эти факты взяты из выдержек поиска по официальным страницам. Пометка **[выдержка]**. Сторонние обзоры помечены **[3-я сторона]**, то, что не удалось подтвердить, — **[не проверено]**.
- Это не юридическая консультация. Раздел 9 — карта рисков и список действий. Тексты Impressum, Datenschutzerklärung и форм согласия перед запуском лучше показать юристу или проверить генератором (eRecht24, IT-Recht-Kanzlei, IHK).

---

## 0. Коротко

1. **Рекомендация: Supabase (регион Frankfurt, `eu-central-1`) + Next.js 16 на Vercel (функции в `fra1`).** У одного поставщика есть Postgres, Auth, Storage, Cron и очереди. Можно закрепить регион ЕС и подписать DPA. RLS и SQL-функции дают атомарное списание звёзд. Бесплатного тарифа хватает на пилот [офиц.]. Firebase хуже подходит: Storage с 03.02.2026 работает только на платном Blaze без жёсткого потолка трат, Firestore неудобен для журнала транзакций, вход по логину без e-mail там тоже делается обходным путём [выдержка].
2. **Логин без e-mail.** Нативного входа по username нет ни в Supabase, ни в Firebase, ни в Better Auth [офиц.], [выдержка]. Стандартный приём: учитель создаёт аккаунт через admin API на «технический» адрес `md1-lisa@u.<домен-Сени>` с `email_confirm: true`. Ученик вводит только `md1-lisa` и пароль. Писем никто не получает, пароль сбрасывает учитель. Регистрацию в Supabase нужно **выключить** («Allow new users to sign up» = off), иначе любой создаст аккаунт через публичный ключ [офиц.].
3. **Деньги и звёзды — только на сервере и в БД.** Цена берётся из таблицы `price_list`, а не от клиента. Списание делает одна SQL-функция в одной транзакции: блокировка кошелька, проверка лимитов, задача, запись в журнал. Баланс не может уйти в минус (`check (balance >= 0)`). Повторный клик не спишет дважды (idempotency key). При `fail` звёзды возвращаются. Журнал только дописывается.
4. **Ключи.** `KIE_API_KEY`, `sb_secret_…`, HMAC-ключ вебхука и `CRON_SECRET` живут только в Vercel Environment Variables (тип *Sensitive*, окружение Production) и в серверных модулях с `import 'server-only'`. В браузер попадают только URL Supabase и *publishable* ключ — он по задумке публичный, данные защищает RLS [офиц.]. Supabase отключает старые ключи `anon` / `service_role` **к концу 2026** — сразу берём новые `sb_publishable_` / `sb_secret_` [офиц.].
5. **Next.js 16:** `middleware.ts` теперь называется `proxy.ts` и по умолчанию работает в Node.js runtime. Next прямо пишет, что Proxy не заменяет авторизацию. Каждая Server Action — это публичный POST-эндпоинт, сессию и права проверяем внутри каждой. Секреты читает только Data Access Layer [Next-доки].
6. **CSP.** В проекте включены `cacheComponents` и `partialPrefetching`. CSP с nonce требует динамического рендера и несовместим с PPR [Next-доки]. Поэтому задаём статичную CSP и заголовки в `next.config.ts` (раздел 8.5).
7. **Vercel Hobby для этого проекта нельзя.** Hobby — только «non-commercial personal use». Коммерческим считается любое развёртывание ради финансовой выгоды кого-либо из участников, включая рекламу своих услуг [выдержка]. Значит, и нынешний сайт курса, и платформа требуют **Pro: $20/мес за место, в цену входит $20 кредита на использование** [3-я сторона].
8. **Бюджет инфраструктуры:** $20/мес (Vercel Pro + Supabase Free) на пилот, **$45/мес (Vercel Pro + Supabase Pro)** на рабочий режим с ежедневными бэкапами. Supabase Free после недели без активности ставит проект на паузу и не делает бэкапов [офиц.].
9. **Право.** В Германии ребёнок сам даёт согласие на онлайн-сервис только с 16 лет: Германия не снижала порог из ст. 8 DSGVO [выдержка]. Для 14–15 лет нужно письменное согласие родителей (собирает клуб), только псевдоним без настоящего имени, без e-mail и фото, принудительный безопасный режим. GDPR распространяется на всех участников, включая Молдову, потому что Сеня — контролёр с местом деятельности в ЕС. Нужны: Impressum по §5 DDG, Datenschutzerklärung (ст. 13), DPA с Supabase, Vercel и kie.ai. **У kie.ai DPA не найден — это главная дыра**, поэтому персональных данных в kie не отправляем.
10. **AI Act, ст. 50, действует с 02.08.2026** (Digital Omnibus её не отложил): нужно сообщать, что ученик общается с ИИ [выдержка]. **Telegram в ЕС — только 18+** по его условиям [выдержка], так что несовершеннолетних из ЕС нельзя «переводить в Telegram».

---

## 1. Сравнение и рекомендация

### 1.1. Supabase vs Firebase по требованиям платформы

| Требование | Supabase | Firebase |
|---|---|---|
| Логин/пароль без e-mail | Нативно нет: только e-mail или телефон + пароль [офиц.] [S15]. Решение — технический e-mail, `auth.admin.createUser({ email_confirm: true })` на сервере [S13], [S14] | Тоже e-mail/пароль. Альтернатива — свой эндпоинт, который проверяет логин и пароль и выдаёт `createCustomToken(uid, claims)`. Тогда хранить и хешировать пароли придётся самому [F2] |
| Учитель создаёт аккаунты, коды приглашения | Admin API с секретным ключом. Регистрацию выключаем, admin API продолжает работать [S12] | Admin SDK `createUser` (service account) |
| Роли admin/teacher/student | Таблица `profiles.role` + RLS-хелперы. Хук Custom Access Token есть и на Free [офиц.] [S1]. `user_metadata` для прав **нельзя**: пользователь сам его меняет [S4] | Custom claims в токене + Security Rules |
| Атомарное списание звёзд, журнал | Postgres-функция в одной транзакции: `select … for update`, `check (balance >= 0)`, уникальные индексы против двойного списания. Отчёты обычным SQL | Транзакции Firestore есть, но журнал и отчёты (сумма за день по группе) делать неудобно: нет SQL и агрегатов в правилах |
| Очередь генераций, повторы | Таблица `jobs` + `for update skip locked`. Есть pg_cron, pgmq (Supabase Queues) и pg_net [офиц.] [S11] | Cloud Functions / Cloud Tasks — только на Blaze |
| Хранение результатов | Storage в том же регионе: 1 ГБ на Free, 100 ГБ на Pro, приватные бакеты, подписанные ссылки [офиц.] [S1] | **С 03.02.2026 Cloud Storage работает только на Blaze**, на Spark API отвечает 402/403 [выдержка] [F1] |
| Тесты с автопроверкой | Ключи ответов в таблице без доступа для учеников, проверка на сервере | Аналогично, через Rules/Functions |
| Регион ЕС | Можно выбрать конкретный регион (Frankfurt). Общая группа «Europe» может попасть в Лондон или Цюрих, они вне ЕС [офиц.] [S9], [S10] | Firestore: `eur3` / `europe-west3` (Frankfurt) [выдержка] [F3] |
| DPA / GDPR | DPA подписывается через PandaDoc из дашборда (Legal documents) [выдержка] [S10] | Google Cloud DPA (CDPA) |
| Бесплатно | 500 МБ БД, 1 ГБ файлов, 5 ГБ трафика, 50 000 MAU, 2 проекта. Пауза после недели без активности, без бэкапов [офиц.] [S1] | Spark: 50k чтений и 20k записей в день, 1 ГБ Firestore. Storage только на Blaze [выдержка] [F3] |
| Потолок трат | Free жёстко ограничен. Pro: $25 + оплата сверх лимитов (spend cap включается в настройках) | Blaze без жёсткого потолка, только бюджетные алерты [не проверено в этом исследовании] |
| Next.js 16 | Официальный гайд `@supabase/ssr` уже под `proxy.ts` и `getClaims()` [офиц.] [S7] | `firebase-admin` на сервере, сессии через cookie — собирать вручную |
| Привязка к поставщику | Обычный Postgres: `pg_dump`, можно переехать | Высокая: NoSQL-модель и Rules |

### 1.2. Альтернативы кратко

| Вариант | Плюсы | Минусы для этого проекта |
|---|---|---|
| **Neon + Better Auth** (или Auth.js) | Auth-данные лежат в своей БД — на одного обработчика меньше. Better Auth 1.7.x: плагины `username`, `admin` (роли, бан, создание пользователей), встроенный rate limit [офиц. репозиторий] [A1]. Neon Free: 0.5 ГБ и 100 CU-часов на проект [выдержка] [A2] | Плагин username тоже требует поле e-mail [A1]. Storage, очередь и cron собирать самим (Vercel Blob / R2). За 4 дня не успеть. RLS по `auth.uid()` нет, только DAL на сервере |
| **Clerk** | Логин по username из коробки, красивые готовые формы. Бесплатно до 50 000 MRU с 05.02.2026 [выдержка] [A3] | Американская компания. Официального заявления об EU-хранении не нашёл [не проверено]. Ещё один обработчик данных детей. БД и Storage всё равно нужны отдельно |
| **Convex** | Транзакционные мутации (удобно для звёзд), встроенные планировщик, cron и файлы. **EU-регион (Dublin) с 06.02.2026 на всех тарифах, включая бесплатный**, ресурсы в EU на ~30% дороже [выдержка] [A4] | Новая модель данных, не SQL, сильная привязка. Своя авторизация без готового «логина по нику» [не проверено] |
| **Firebase** | См. 1.1 | Blaze для Storage, NoSQL для журнала |

### 1.3. Почему Supabase и как именно его использовать

Рекомендация: **Supabase в конкретном регионе «Central EU (Frankfurt)»**, схема **«сервер прежде всего»**:

- **Браузер** ходит в Supabase только за входом: `signInWithPassword` с publishable ключом. Запрос идёт с IP ученика, поэтому лимиты Supabase по IP работают честно. Больше браузер ничего напрямую не делает.
- **Чтение** в Server Components идёт через «пользовательский» клиент (publishable ключ + cookie ученика). RLS — второй рубеж: даже если в коде ошибка, ученик не увидит чужое.
- **Запись** идёт только через сервер. DAL сначала проверяет сессию и роль, потом вызывает SQL-функцию секретным ключом. У учеников в БД **нет прав на INSERT/UPDATE/DELETE вообще**.
- Почему RLS обязателен даже при «сервер прежде всего». Cookie сессии `@supabase/ssr` по умолчанию доступны JavaScript, потому что браузерному клиенту они нужны. Ученик может вытащить свой JWT и вместе с публичным ключом обратиться к Data API напрямую. Отвечать ему будет только RLS.
- **Две ловушки Supabase**, найденные в актуальной документации [офиц.] [S3]:
  1. На существующих проектах новые таблицы в `public` **автоматически получают гранты** для `anon` и `authenticated` и становятся доступны через Data API. Выключить: Data API settings → «Automatically expose new tables». Плюс явный `revoke` в миграциях.
  2. Новые **функции по умолчанию может вызвать любой** (`EXECUTE` для `PUBLIC`). Каждую функцию списания нужно закрывать: `revoke execute … from public, anon, authenticated` и `grant execute … to service_role`.
- Ещё одно правило Supabase: **`security definer`-функцию нельзя класть в схему, открытую через API** [офиц.] [S4]. Поэтому функции денег сделаны `security invoker` в `public`, а выполнять их может только `service_role`. RLS-хелперы — `security definer` в непубличной схеме `private`.

---

## 2. Архитектура

### 2.1. Схема компонентов и зоны доверия

```
 [Браузер: ученик / учитель / админ]        зона НЕДОВЕРИЯ
   │ HTTPS · cookie сессии Supabase · только NEXT_PUBLIC_SUPABASE_URL + publishable key
   │ вход: supabase.auth.signInWithPassword(login → login@u.<домен>)  ──────────────┐
   ▼                                                                               │
 [Vercel, регион fra1 — Next.js 16 App Router]             зона СЕРВЕРА (секреты)  │
   ├─ proxy.ts ........... обновление сессии (getClaims), оптимистичные редиректы, │
   │                       язык (/ru /en /de /uk). НЕ авторизация                  │
   ├─ Server Components .. чтение через DAL → user-клиент → RLS                    │
   ├─ Server Actions ..... формы учителя/админа (каждая сама проверяет роль)       │
   ├─ Route Handlers                                                               │
   │    /api/generate  /api/jobs/[id]  /api/chat  /api/uploads/sign               │
   │    /api/webhooks/kie   ← kie.ai (per-job токен + HMAC + перезапрос)           │
   │    /api/cron/tick      ← Vercel Cron (Authorization: Bearer CRON_SECRET)      │
   └─ lib/server/** ('server-only'): env, supabase-admin (sb_secret_…),           │
        kie-адаптеры (whitelist моделей), модерация, storage, audit                │
        │ RPC секретным ключом                 │ Bearer KIE_API_KEY                │
        ▼                                      ▼                                   │
 [Supabase, Frankfurt eu-central-1]     [kie.ai API] → поставщики моделей          │
   Auth (пароли, сессии) ◄──────────────────────────────────────────────────────────┘
   Postgres: RLS, функции звёзд, jobs, тесты, audit_log, pg_cron
   Storage: приватные бакеты media/ и uploads/ (только подписанные ссылки)
```

Инварианты держит **база**, а не код. Баланс ≥ 0. Одно списание и один возврат на задачу (уникальные индексы). Журнал только дописывается (триггер). Цена берётся из `price_list`. Ученик ничего не пишет напрямую.

### 2.2. Поток «вход»

1. Ученик вводит `md1-lisa` и пароль. Браузер превращает логин в `md1-lisa@u.<домен>` и вызывает `signInWithPassword`.
2. `@supabase/ssr` кладёт сессию в cookie. `proxy.ts` на каждом запросе вызывает `supabase.auth.getClaims()`: она проверяет подпись токена и обновляет его. **`getSession()` на сервере не использовать**: она читает cookie без проверки [офиц.] [S7].
3. В каждом Server Component, Action и Route Handler DAL вызывает `requireUser()`: `getClaims()`, затем `profiles` (role, disabled, age_band, group), и возвращает минимальный DTO.
4. При ошибке входа показываем общее «логин или пароль неверны», без подсказки, что именно не так (иначе можно перебором узнать существующие логины).

Почему вход из браузера, а не через Server Action. Supabase ограничивает вход по IP: эндпоинт токенов — 150 запросов за 5 минут, всплеск до 30 [офиц.] [S5]. Если входить с сервера Vercel, все ученики попадают в одну «корзину» IP Vercel. Это можно обойти заголовком `Sb-Forwarded-For` с секретным ключом [S5], но это лишняя сложность и лишнее использование секрета.

### 2.3. Поток «генерация» (картинка, видео, музыка, голос)

```
Браузер → POST /api/generate {action, prompt, options, idempotencyKey}
  1. requireUser(); zod-схема (action из enum, prompt ≤ 1000 символов, options из whitelist)
  2. модерация: стоп-слова → поиск ПДн (телефон/e-mail/адрес) → LLM-классификатор
     (для младших fail-closed: ошибка классификатора = отказ). Отказ → 422, звёзды не списаны
  3. buildKieInput(action, …) — адаптер под модель; model берётся из price_list
  4. rpc create_generation_job(...) — атомарно: лимиты, списание, jobs(status=queued), журнал
  5. ответ 202 {jobId}; дальше after(() => submitJob(jobId))
       claim_jobs(1, jobId) → createTask(callBackUrl=/api/webhooks/kie?job=<id>&t=<hmac>)
       ok → mark_submitted(taskId);  429/5xx/сеть до ответа → requeue_job (backoff)
       таймаут после отправки → status=unknown (без авто-повтора: иначе двойное списание у kie)
kie.ai → POST /api/webhooks/kie
  6. проверка per-job токена + HMAC-подписи kie → 200 сразу; after(() => processFinishedTask)
  7. GET recordInfo (источник правды) → success: begin_storing → скачать (allowlist хостов,
     лимит размера, проверка типа) → Storage media/{user}/{job}/… → complete_job
     fail → fail_job(refund=true)
Браузер → GET /api/jobs/{id} каждые 3 → 10 с
  8. статус + подписанные ссылки (TTL 1 ч). Если submitted и последняя проверка > 20 с назад —
     сервер сам дёргает recordInfo (страховка, если вебхук потерялся)
Vercel Cron → GET /api/cron/tick раз в минуту (Pro)
  9. отправить queued, опросить зависшие submitted, повторить storing, закрыть задачи > 30 мин
     с возвратом, алерты Сене, ночью — очистка по сроку хранения
```

Чат (сценарии, промпты, проверка ответов) работает **синхронно** через тот же журнал: `create_generation_job('chat.msg')` → вызов kie (Claude или GPT маршрут, см. [K1] §3.2) → `complete_job(…, p_text)` или `fail_job`. Ставим `max_tokens` и `maxDuration = 60`.

### 2.4. Где что работает в Next.js 16 (проверено по документации 16.4.3)

| Механизм | Что говорит документация | Как используем |
|---|---|---|
| `proxy.ts` (бывший middleware) | «Starting with Next.js 16, Middleware is now called Proxy». По умолчанию Node.js runtime, опцию `runtime` задавать нельзя. Не для медленных запросов к данным и «not … a full session management or authorization solution» [N1], [N9] | Обновление сессии Supabase, оптимистичные редиректы `/app`, `/teach`, `/admin` → `/login`, редирект на язык [N11]. Без запросов в БД |
| Server Functions и Proxy | Server Functions — это POST на тот маршрут, где они используются. Если matcher исключает путь, Proxy пропускает и их [N9] | Авторизация **внутри** каждой Action, на Proxy не полагаемся |
| Server Actions | Доступны прямым POST, а не только из UI. ID шифруются и меняются между сборками, но «verify authentication and authorization inside each one». Сравниваются Origin и Host (защита от CSRF). Аргументы-замыкания шифруются, но «don't recommend relying on encryption alone» [N3] | `requireRole('teacher')` + проверка, что группа своя (защита от IDOR) + zod + возвращаем `{ok:true}`, а не строки БД |
| Route Handlers | Кешируются только GET и только при явном включении. С Cache Components выполняются при запросе, если читают request/cookies [N2] | Все наши handlers читают запрос, поэтому динамические |
| Data Access Layer | Только на сервере, проверяет права, возвращает DTO. «Only the Data Access Layer should access `process.env`». `import 'server-only'` даёт ошибку сборки при импорте в клиент [N3] | `lib/server/**` |
| `NEXT_PUBLIC_` | Встраивается в JS-бандл на этапе сборки [N7] | Только `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Taint API | `experimental.taint` + `taintUniqueValue` — дополнительный слой против утечки значений в клиент [N3] | Пометить `KIE_API_KEY` и `SUPABASE_SECRET_KEY` |
| Cache Components (включён в проекте) | Чтение сессии происходит при запросе, UI пользователя рендерится за `<Suspense>`. `use cache` не может вызывать `cookies()`, для данных из сессии есть `use cache: private`. **Секреты и ПДн нельзя класть в ключи и теги кеша**: они хранятся открытым текстом. Конфиг сегмента `dynamic` с Cache Components удалён, `maxDuration` работает [N5], [N12] | Страницы ученика: оболочка статична, данные за Suspense. В ключах кеша только `userId` |
| `after()` | Работает после отправки ответа, на Vercel через `waitUntil`, ограничен `maxDuration` маршрута [N10] | Отправка в kie и копирование результатов после ответа |
| `forbidden()` / `unauthorized()` | Экспериментально, нужен `experimental.authInterrupts` [N4] | Можно использовать для страниц 403/401 |
| Rate limiting | В гайде BFF: «enable any rate limiting features provided by your host» + проверка в коде [N8] | Раздел 8.3 |
| Webhooks | Route Handler, проверка секрета, защита от open redirect для callback URL [N8] | Раздел 5.2 |

### 2.5. Структура папок (набросок)

```
proxy.ts                         сессия Supabase + редиректы + язык
app/[lang]/(site)/…              публичный сайт (как сейчас, с переводами)
app/[lang]/login/page.tsx
app/[lang]/app/…                 кабинет ученика: уроки, галерея, баланс
app/[lang]/teach/…               кабинет учителя
app/[lang]/admin/…               админ (Сеня): цены, рубильник, траты, аудит
app/api/generate/route.ts        app/api/jobs/[id]/route.ts      app/api/chat/route.ts
app/api/uploads/sign/route.ts    app/api/webhooks/kie/route.ts   app/api/cron/tick/route.ts
lib/server/env.ts                'server-only', zod-проверка переменных (читать лениво)
lib/server/supabase/{admin,user}.ts
lib/server/dal/{auth,jobs,wallet,quiz,teacher}.ts
lib/server/kie/{client,adapters,webhook}.ts
lib/server/moderation/{blocklist,pii,classifier}.ts
lib/server/storage.ts            lib/server/audit.ts
content/lessons/{ru,en,de,uk}/…  тексты уроков (как content/site.ts)
supabase/migrations/*.sql        supabase/tests/*.sql (pgTAP)
vercel.json                      { "regions": ["fra1"], "crons": [...] }
```

---

## 3. Аккаунты, роли, коды приглашения

**Логины.** Формат `<код группы>-<ник>`: `md1-lisa`, `sen1-olga`. Ник — псевдоним, настоящее имя не нужно. Технический адрес `md1-lisa@u.<домен-Сени>`: поддомен без MX-записи, туда никогда ничего не отправляется. Домен `.invalid` формально зарезервирован, но пропустит ли его валидатор Supabase, я не проверял [не проверено]. Свой поддомен надёжнее.

**Пароли.** Учитель создаёт пачку аккаунтов. Сервер генерирует читаемые пароли из трёх слов и двух цифр (`kiwi-raketa-sova-42`, 18+ символов) и показывает их **один раз** для печати карточек. Хранится только хеш в Supabase Auth. Минимальная длина в настройках Auth — 10+ символов; Supabase не рекомендует меньше 8 [офиц.] [S6]. Проверка по базе утёкших паролей (HaveIBeenPwned) есть только на Pro [офиц.] [S1]. Ученик может сменить пароль. Если забыл — сбрасывает учитель, писем нет.

**Учителя и админ** входят по настоящему e-mail с обязательной MFA (TOTP). Базовая MFA есть на Free [офиц.] [S1].

**Роли:** `admin` (Сеня), `teacher` (ведущие групп), `student`. Роль хранится в `profiles.role`, менять её может только админ через серверную функцию. **Не в `user_metadata`**: его меняет сам пользователь [офиц.] [S4]. По желанию её можно дублировать в JWT через Custom Access Token Hook (есть на Free) [S1], но источник правды — таблица.

**Коды приглашения** (после MVP или в день 4, если останется время). Учитель создаёт код группы: 8 символов, срок 7 дней, лимит использований = размер группы. В БД хранится **хеш** кода. Ученик на `/join` вводит код, ник, пароль и возраст (галочка «мне есть 16 / 18»). Аккаунт для младших создаётся в состоянии «ждёт согласия родителей», генерации заблокированы на уровне БД. Лимит: 10 попыток в час с одного IP, неверный код — общий ответ. Для первого курса в Молдове проще и безопаснее, чтобы аккаунты создавал учитель и раздавал карточки через клуб.

**В Supabase Auth выключить:** «Allow new users to sign up», «Allow anonymous sign-ins». «Confirm email» не важен: admin API создаёт пользователей уже подтверждёнными [офиц.] [S12], [S13].

---

## 4. Схема БД (SQL-набросок с RLS)

Это набросок для первой миграции `supabase/migrations/0001_platform.sql`. Перед запуском нужны тесты (4.4) и `supabase db lint`.

**Что уже проверено.** SQL из разделов 4.1–4.3 прогнан 01.11.2026 на локальном PostgreSQL 16.15. Схема `auth`, `auth.uid()` и роли `anon` / `authenticated` / `service_role` были заглушками, как в Supabase. Подтвердилось:
- схема применяется без ошибок;
- повтор с тем же idempotency key не списывает второй раз;
- `not_for_minors` и `consent_missing` срабатывают;
- `requeue_job` откладывает повтор;
- `begin_storing` пропускает только первый обработчик;
- двойной `fail_job` возвращает звёзды один раз;
- бонус за тест начисляется один раз;
- журнал не меняется (`append-only`);
- ученик видит только свои строки, учитель — свою группу;
- `anon` не видит ничего;
- ученик получает `permission denied` на UPDATE кошелька, на прямой вызов списания, на `quiz_keys` и на `settings`.

Не проверено: работа на самом Supabase (его стандартные гранты и настройки Data API), конкурентная нагрузка, pgTAP.

### 4.1. Гигиена, типы, таблицы

```sql
-- ===== 0. Гигиена прав (см. раздел 1.3) =====
create schema if not exists private;                 -- НЕ добавлять в "Exposed schemas"
revoke all on schema private from public;
grant usage on schema private to authenticated;      -- только чтобы RLS мог вызвать хелперы

-- новые объекты не открываются сами (плюс выключить "Automatically expose new tables")
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ===== 1. Типы =====
create type public.app_role   as enum ('admin', 'teacher', 'student');
create type public.age_band   as enum ('u16', '16_17', 'adult');   -- дату рождения НЕ храним
create type public.job_status as enum
  ('queued', 'submitting', 'submitted', 'storing', 'done', 'failed', 'unknown');

-- ===== 2. Группы и профили =====
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9]{2,12}$'),  -- префикс логинов
  title       text not null,
  kind        text not null check (kind in ('youth','seniors','corporate','individual')),
  teacher_id  uuid not null references auth.users(id),
  paused      boolean not null default false,                         -- «стоп-кран» учителя
  daily_cap   int  not null default 4000 check (daily_cap >= 0),      -- звёзд в день на группу
  ends_on     date,
  purge_after date,                                                    -- когда удалить данные
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  login               text not null unique check (login ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  nickname            text not null check (char_length(nickname) between 1 and 40),
  role                public.app_role not null default 'student',
  group_id            uuid references public.groups(id) on delete set null,
  age_band            public.age_band not null default 'u16',  -- по умолчанию самый строгий
  parental_consent_at timestamptz,         -- учитель отметил: письменное согласие получено
  disabled            boolean not null default false,
  locale              text not null default 'ru' check (locale in ('ru','en','de','uk')),
  created_at          timestamptz not null default now()
);
create index on public.profiles (group_id);

-- ===== 3. Звёзды =====
create table public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),   -- в минус уйти нельзя физически
  daily_cap  int not null default 300 check (daily_cap >= 0),
  updated_at timestamptz not null default now()
);

create table public.star_ledger (                  -- журнал: только дописывается
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  delta         int  not null check (delta <> 0),
  reason        text not null check (reason in ('grant','debit','refund','quiz_bonus','adjust')),
  job_id        uuid,
  ref           text,                              -- например id теста для бонуса
  note          text,
  balance_after int  not null,
  actor_id      uuid,                              -- кто инициировал (ученик/учитель/система)
  created_at    timestamptz not null default now()
);
create unique index ledger_one_debit_one_refund on public.star_ledger (job_id, reason)
  where job_id is not null;                        -- не больше одного списания и возврата на задачу
create unique index ledger_quiz_bonus_once on public.star_ledger (user_id, ref)
  where reason = 'quiz_bonus';
create index on public.star_ledger (user_id, created_at);

create table public.price_list (                   -- whitelist действий и моделей
  action     text primary key,                     -- 'image.basic', 'video.5s.480p', 'music.track', 'tts.30s', 'chat.msg'
  model      text not null,                        -- id модели kie (см. kie-models.md)
  stars      int  not null check (stars > 0),
  minors_ok  boolean not null default false,       -- разрешено ли u16 / 16_17
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.settings (key text primary key, value jsonb not null);
-- 'generation_enabled' = true/false (глобальный рубильник), 'global_daily_cap' = 20000

-- ===== 4. Задачи генерации =====
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  group_id         uuid references public.groups(id) on delete set null,
  action           text not null references public.price_list(action),
  model            text not null,
  stars            int  not null,
  prompt           text not null check (char_length(prompt) <= 2000),
  input            jsonb not null default '{}',     -- собран сервером, не клиентом
  status           public.job_status not null default 'queued',
  idempotency_key  text not null,
  kie_task_id      text unique,
  attempts         int  not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_polled_at   timestamptz,
  credits_consumed numeric,                         -- фактическое списание kie (recordInfo)
  result_paths     text[],                          -- пути в Storage, не URL kie
  result_text      text,                            -- ответ чат-модели
  moderation       jsonb,
  hidden           boolean not null default false,  -- учитель скрыл результат
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index on public.jobs (status, next_attempt_at);
create index on public.jobs (user_id, created_at desc);
create index on public.jobs (group_id, created_at desc);

-- ===== 5. Тесты =====
create table public.quizzes (
  id           uuid primary key default gen_random_uuid(),
  lesson_slug  text not null,
  title        text not null,
  pass_percent int  not null default 70 check (pass_percent between 1 and 100),
  bonus_stars  int  not null default 0 check (bonus_stars between 0 and 500),
  max_attempts int  not null default 3,
  published    boolean not null default false
);
create table public.quiz_questions (
  id       uuid primary key default gen_random_uuid(),
  quiz_id  uuid not null references public.quizzes(id) on delete cascade,
  position int  not null,
  kind     text not null check (kind in ('single','multi','text','number')),
  body     jsonb not null              -- текст вопроса и варианты на 4 языках, БЕЗ правильного ответа
);
create table public.quiz_keys (        -- ключи ответов: у учеников нет даже SELECT
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  answer      jsonb not null           -- {"correct":"b"} | {"correct":["a","c"]} | {"accept":["нейросеть"]} | {"value":42,"tol":0}
);
create table public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  answers      jsonb not null,
  score        int not null,
  max_score    int not null,
  submitted_at timestamptz not null default now()
);

-- ===== 6. Приглашения и аудит =====
create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code_hash  text not null unique,          -- sha256(код + pepper), сам код не храним
  group_id   uuid not null references public.groups(id) on delete cascade,
  max_uses   int  not null default 20,
  uses       int  not null default 0,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id)
);
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,                -- 'create_students','reset_password','grant_stars','prompt_blocked','kie_webhook_bad_signature',…
  target_user uuid,
  meta        jsonb,
  ip_hash     text,                         -- хеш IP с солью, не сам IP
  created_at  timestamptz not null default now()
);

-- журнал звёзд нельзя менять задним числом (кроме удаления по сроку хранения).
-- Функция удаления ученика/группы сначала делает set_config('app.ledger_purge', 'on', true),
-- иначе каскадное удаление из profiles тоже упрётся в этот триггер.
create or replace function private.ledger_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.ledger_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception 'star_ledger is append-only';
end $$;
create trigger ledger_append_only before update or delete on public.star_ledger
  for each row execute function private.ledger_append_only();
```

### 4.2. RLS и гранты

```sql
-- Хелперы для политик: security definer, search_path пустой, схема private
create or replace function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and not p.disabled
$$;
create or replace function private.teaches(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false)
      or exists (select 1 from public.groups g
                  where g.id = p_group and g.teacher_id = (select auth.uid()))
$$;
create or replace function private.teaches_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.teaches((select p.group_id from public.profiles p where p.id = p_user))
$$;
revoke all on function private.my_role(), private.teaches(uuid), private.teaches_user(uuid) from public;
grant execute on function private.my_role(), private.teaches(uuid), private.teaches_user(uuid) to authenticated;

-- Включаем RLS везде и отбираем все права у клиентских ролей
do $$ declare t text; begin
  foreach t in array array['groups','profiles','wallets','star_ledger','price_list','settings',
    'jobs','quizzes','quiz_questions','quiz_keys','quiz_attempts','invite_codes','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Ученикам и учителям: ТОЛЬКО SELECT и только на эти таблицы. Никаких insert/update/delete.
grant select on public.groups, public.profiles, public.wallets, public.star_ledger,
  public.price_list, public.jobs, public.quizzes, public.quiz_questions,
  public.quiz_attempts, public.audit_log to authenticated;
-- settings, quiz_keys, invite_codes: грантов нет вообще → только сервер (service_role)

-- Сервер (секретный ключ) работает как service_role. Права даём явно: после выключения
-- «Automatically expose new tables» автоматических грантов на новые таблицы может не быть [S3]
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy groups_read  on public.groups  for select to authenticated
  using ( private.teaches(id)
          or id = (select p.group_id from public.profiles p where p.id = (select auth.uid())) );
create policy profiles_read on public.profiles for select to authenticated
  using ( id = (select auth.uid()) or private.teaches(group_id) );
create policy wallets_read on public.wallets for select to authenticated
  using ( user_id = (select auth.uid()) or private.teaches_user(user_id) );
create policy ledger_read  on public.star_ledger for select to authenticated
  using ( user_id = (select auth.uid()) or private.teaches_user(user_id) );
create policy jobs_read    on public.jobs for select to authenticated
  using ( user_id = (select auth.uid()) or private.teaches(group_id) );
create policy prices_read  on public.price_list for select to authenticated using ( enabled );
create policy quizzes_read on public.quizzes for select to authenticated using ( published );
create policy questions_read on public.quiz_questions for select to authenticated
  using ( exists (select 1 from public.quizzes q where q.id = quiz_id and q.published) );
create policy attempts_read on public.quiz_attempts for select to authenticated
  using ( user_id = (select auth.uid()) or private.teaches_user(user_id) );
create policy audit_admin_read on public.audit_log for select to authenticated
  using ( (select private.my_role()) = 'admin' );
```

**Storage.** Два приватных бакета: `media` (результаты, путь `{user_id}/{job_id}/{n}.webp|mp4|mp3`) и `uploads` (фото взрослых, путь `{user_id}/…`). **Политик для клиентов на `storage.objects` не создаём вообще.** Все ссылки выдаёт сервер (`createSignedUrl`, TTL 1 ч) после проверки прав в DAL. Загрузка взрослых идёт по `createSignedUploadUrl`, прямо в Supabase, минуя Vercel: у функций Vercel жёсткий лимит тела запроса 4.5 МБ на всех тарифах [выдержка] [V10]. Бэкапы БД **не содержат файлов Storage** [офиц.] [S8].

### 4.3. Функции денег и очереди (выполнять может только `service_role`)

```sql
-- Создать задачу и списать звёзды: всё или ничего
create or replace function public.create_generation_job(
  p_user uuid, p_action text, p_prompt text, p_input jsonb, p_idem text, p_moderation jsonb default null)
returns table (out_job_id uuid, out_balance int, out_reused boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  v_prof  public.profiles%rowtype;
  v_price public.price_list%rowtype;
  v_bal int; v_cap int; v_spent int; v_job uuid;
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  if not coalesce((select (s.value)::boolean from public.settings s where s.key = 'generation_enabled'), false) then
    raise exception 'generation_disabled';
  end if;
  select * into v_prof from public.profiles where id = p_user;
  if not found or v_prof.disabled then raise exception 'user_disabled'; end if;
  if v_prof.age_band <> 'adult' and v_prof.parental_consent_at is null then raise exception 'consent_missing'; end if;

  select * into v_price from public.price_list where action = p_action and enabled;
  if not found then raise exception 'unknown_action'; end if;
  if v_prof.age_band <> 'adult' and not v_price.minors_ok then raise exception 'not_for_minors'; end if;

  -- порядок блокировок всегда: группа → кошелёк (без взаимных блокировок)
  if v_prof.group_id is not null then
    perform 1 from public.groups g where g.id = v_prof.group_id and not g.paused for update;
    if not found then raise exception 'group_paused'; end if;
  end if;
  select w.balance, w.daily_cap into v_bal, v_cap from public.wallets w where w.user_id = p_user for update;
  if not found then raise exception 'no_wallet'; end if;

  -- идемпотентность ПОСЛЕ блокировки: повторный клик вернёт ту же задачу без списания
  select j.id into v_job from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idem;
  if found then return query select v_job, v_bal, true; return; end if;

  if (select count(*) from public.jobs j where j.user_id = p_user
        and j.status in ('queued','submitting','submitted','storing')) >= 3 then
    raise exception 'too_many_in_flight';
  end if;

  select coalesce(-sum(l.delta), 0) into v_spent from public.star_ledger l
   where l.user_id = p_user and l.reason in ('debit','refund') and l.created_at >= v_today;
  if v_spent + v_price.stars > v_cap then raise exception 'daily_cap_user'; end if;

  if v_prof.group_id is not null and (
       select coalesce(-sum(l.delta), 0) from public.star_ledger l
         join public.profiles p on p.id = l.user_id
        where p.group_id = v_prof.group_id and l.reason in ('debit','refund') and l.created_at >= v_today
     ) + v_price.stars > (select g.daily_cap from public.groups g where g.id = v_prof.group_id) then
    raise exception 'daily_cap_group';
  end if;

  if (select coalesce(-sum(l.delta), 0) from public.star_ledger l
       where l.reason in ('debit','refund') and l.created_at >= v_today) + v_price.stars
     > coalesce((select (s.value)::int from public.settings s where s.key = 'global_daily_cap'), 0) then
    raise exception 'daily_cap_global';
  end if;

  if v_bal < v_price.stars then raise exception 'insufficient_stars'; end if;

  insert into public.jobs (user_id, group_id, action, model, stars, prompt, input, idempotency_key, moderation)
  values (p_user, v_prof.group_id, p_action, v_price.model, v_price.stars, p_prompt, p_input, p_idem, p_moderation)
  returning id into v_job;

  update public.wallets set balance = balance - v_price.stars, updated_at = now()
   where user_id = p_user returning balance into v_bal;
  insert into public.star_ledger (user_id, delta, reason, job_id, balance_after, actor_id)
  values (p_user, -v_price.stars, 'debit', v_job, v_bal, p_user);

  return query select v_job, v_bal, false;
end $$;

-- Взять задачи в работу (cron или конкретную задачу сразу после создания)
create or replace function public.claim_jobs(p_limit int default 4, p_only uuid default null)
returns setof public.jobs language sql security invoker set search_path = '' as $$
  update public.jobs j set status = 'submitting', attempts = j.attempts + 1, updated_at = now()
   where j.id in (select q.id from public.jobs q
                   where q.status = 'queued' and q.next_attempt_at <= now()
                     and (p_only is null or q.id = p_only)
                   order by q.created_at limit p_limit
                   for update skip locked)
  returning j.*;
$$;

create or replace function public.mark_submitted(p_job uuid, p_task text) returns void
language sql security invoker set search_path = '' as $$
  update public.jobs set status = 'submitted', kie_task_id = p_task, last_polled_at = now(), updated_at = now()
   where id = p_job and status = 'submitting';
$$;

-- Вернуть звёзды и закрыть задачу (повторный вызов ничего не делает)
create or replace function public.fail_job(p_job uuid, p_error text, p_refund boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_job public.jobs%rowtype; v_bal int;
begin
  select * into v_job from public.jobs where id = p_job for update;
  if not found or v_job.status in ('done','failed') then return; end if;
  update public.jobs set status = 'failed', error = left(p_error, 500), updated_at = now() where id = p_job;
  if p_refund then
    update public.wallets set balance = balance + v_job.stars, updated_at = now()
     where user_id = v_job.user_id returning balance into v_bal;
    insert into public.star_ledger (user_id, delta, reason, job_id, balance_after)
    values (v_job.user_id, v_job.stars, 'refund', p_job, v_bal);   -- второй возврат упрётся в уникальный индекс
  end if;
end $$;

-- Повтор с экспоненциальной паузой: 30 с, 1, 2, 4 мин; после 5 попыток — fail с возвратом
create or replace function public.requeue_job(p_job uuid, p_error text) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_attempts int;
begin
  select attempts into v_attempts from public.jobs where id = p_job and status = 'submitting' for update;
  if not found then return; end if;
  if v_attempts >= 5 then
    perform public.fail_job(p_job, 'gave_up: ' || p_error, true);
  else
    update public.jobs set status = 'queued', error = left(p_error, 500), updated_at = now(),
           next_attempt_at = now() + make_interval(secs => 15 * power(2, v_attempts))
     where id = p_job;
  end if;
end $$;

-- Ровно один обработчик копирует результат (вебхук и опрос могут прийти одновременно)
create or replace function public.begin_storing(p_job uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with u as (update public.jobs set status = 'storing', updated_at = now()
              where id = p_job and status = 'submitted' returning 1)
  select exists (select 1 from u);
$$;

create or replace function public.complete_job(p_job uuid, p_paths text[], p_credits numeric, p_text text default null)
returns void language sql security invoker set search_path = '' as $$
  update public.jobs set status = 'done', result_paths = p_paths, result_text = p_text,
         credits_consumed = p_credits, updated_at = now()
   where id = p_job and status in ('storing','submitting');     -- 'submitting' — синхронный чат
$$;

-- Начисление/корректировка звёзд учителем или админом
create or replace function public.grant_stars(p_actor uuid, p_user uuid, p_amount int, p_note text)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_bal int; v_role public.app_role; v_ok boolean;
begin
  if p_amount = 0 or abs(p_amount) > 5000 then raise exception 'bad_amount'; end if;
  select role into v_role from public.profiles where id = p_actor and not disabled;
  v_ok := v_role = 'admin' or (v_role = 'teacher' and exists (
            select 1 from public.profiles s join public.groups g on g.id = s.group_id
             where s.id = p_user and g.teacher_id = p_actor));
  if not coalesce(v_ok, false) then raise exception 'forbidden'; end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + p_amount, updated_at = now()
   where user_id = p_user returning balance into v_bal;          -- check (balance >= 0) не пустит в минус
  insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note)
  values (p_user, p_amount, case when p_amount > 0 then 'grant' else 'adjust' end, v_bal, p_actor, left(p_note, 200));
  insert into public.audit_log (actor_id, action, target_user, meta)
  values (p_actor, 'grant_stars', p_user, jsonb_build_object('amount', p_amount));
  return v_bal;
end $$;

-- Запись попытки теста + бонус один раз (оценку считает сервер, см. раздел 6)
create or replace function public.record_quiz_attempt(p_user uuid, p_quiz uuid, p_answers jsonb, p_score int, p_max int)
returns table (out_attempt uuid, out_bonus int)
language plpgsql security invoker set search_path = '' as $$
declare v_q public.quizzes%rowtype; v_att uuid; v_bal int; v_bonus int := 0;
begin
  perform 1 from public.wallets where user_id = p_user for update;   -- сериализуем попытки ученика
  select * into v_q from public.quizzes where id = p_quiz and published;
  if not found then raise exception 'quiz_not_found'; end if;
  if (select count(*) from public.quiz_attempts a where a.user_id = p_user and a.quiz_id = p_quiz) >= v_q.max_attempts then
    raise exception 'too_many_attempts';
  end if;
  insert into public.quiz_attempts (user_id, quiz_id, answers, score, max_score)
  values (p_user, p_quiz, p_answers, p_score, p_max) returning id into v_att;
  if v_q.bonus_stars > 0 and p_max > 0 and p_score * 100 >= v_q.pass_percent * p_max
     and not exists (select 1 from public.star_ledger l
                      where l.user_id = p_user and l.reason = 'quiz_bonus' and l.ref = p_quiz::text) then
    update public.wallets set balance = balance + v_q.bonus_stars, updated_at = now()
     where user_id = p_user returning balance into v_bal;
    insert into public.star_ledger (user_id, delta, reason, ref, balance_after, actor_id)
    values (p_user, v_q.bonus_stars, 'quiz_bonus', p_quiz::text, v_bal, p_user);
    v_bonus := v_q.bonus_stars;
  end if;
  return query select v_att, v_bonus;
end $$;

-- Закрываем ВСЕ функции от клиентов (по умолчанию EXECUTE есть у PUBLIC — см. раздел 1.3)
do $$ declare f text; begin
  foreach f in array array[
    'public.create_generation_job(uuid,text,text,jsonb,text,jsonb)',
    'public.claim_jobs(int,uuid)', 'public.mark_submitted(uuid,text)',
    'public.fail_job(uuid,text,boolean)', 'public.requeue_job(uuid,text)',
    'public.begin_storing(uuid)', 'public.complete_job(uuid,text[],numeric,text)',
    'public.grant_stars(uuid,uuid,int,text)',
    'public.record_quiz_attempt(uuid,uuid,jsonb,int,int)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
```

### 4.4. Тест RLS (pgTAP, `supabase test db`)

Supabase рекомендует на каждую таблицу файл в `supabase/tests/` с проверками «разрешено/запрещено» для `anon` и `authenticated` [офиц.] [S4].

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'md1-a@u.test'),
  ('00000000-0000-0000-0000-00000000000b', 'md1-b@u.test');
insert into public.profiles (id, login, nickname) values
  ('00000000-0000-0000-0000-00000000000a', 'md1-a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'md1-b', 'B');
insert into public.wallets (user_id, balance) values
  ('00000000-0000-0000-0000-00000000000a', 1000), ('00000000-0000-0000-0000-00000000000b', 1000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select results_eq($$ select count(*)::int from public.wallets $$, array[1], 'видит только свой кошелёк');
select throws_ok($$ update public.wallets set balance = 999999 $$, '42501', null, 'не может менять баланс');
select throws_ok($$ select * from public.create_generation_job('00000000-0000-0000-0000-00000000000a',
                    'image.basic', 'кот', '{}'::jsonb, 'k1', null) $$, '42501', null, 'не может списывать сам');
select throws_ok($$ select * from public.quiz_keys $$, '42501', null, 'ключи ответов недоступны');

select * from finish();
rollback;
```

---

## 5. Очередь, вебхуки kie, повторы, хранение

### 5.1. Статусы задачи

| Статус | Что значит | Кто переводит дальше |
|---|---|---|
| `queued` | Звёзды списаны, ждёт отправки | `after()` сразу или cron (`claim_jobs`) |
| `submitting` | Отправляем в kie | `mark_submitted` / `requeue_job` / `unknown` |
| `submitted` | Есть `kie_task_id`, kie считает | Вебхук или опрос → `begin_storing` / `fail_job` |
| `storing` | Копируем файлы к себе | `complete_job`. При ошибке — повтор из cron, после 5 неудач `fail_job` |
| `done` / `failed` | Конец. При `failed` звёзды возвращены | — |
| `unknown` | createTask мог пройти, но ответа нет (таймаут) | Не повторяем автоматически, иначе kie спишет дважды [K1] §3.1. Через 30 мин `fail_job` с возвратом + запись для сверки |

### 5.2. Вебхук kie: проверка

Что известно о kie [K1] §3.3: подпись `X-Webhook-Signature` = base64(HMAC-SHA256(`taskId.timestamp`, ключ из kie.ai/settings)) и `X-Webhook-Timestamp`. **Подпись не покрывает тело**, поэтому kie сам советует перезапросить задачу. Повторы доставки не описаны. Мы защищаемся тремя независимыми слоями:

1. **Per-job токен в URL.** `callBackUrl = https://<домен>/api/webhooks/kie?job=<jobId>&t=<base64url(HMAC(jobId, KIE_CALLBACK_SECRET))>`. Подделать без нашего секрета нельзя. Слой работает, даже если kie поменяет формат подписи.
2. **HMAC kie** (функция `verifyKieWebhook` из [K1] §3.3), допуск по времени ±300 с, сравнение в постоянное время.
3. **Тело не доверяем.** После проверки делаем `GET recordInfo?taskId=…` и меняем статус только по нему. Обработка идемпотентна: `begin_storing` пропускает только один обработчик.

```ts
// app/api/webhooks/kie/route.ts  (набросок)
import { after } from 'next/server'
import { verifyJobToken, verifyKieWebhook } from '@/lib/server/kie/webhook' // 'server-only' внутри
import { processFinishedTask } from '@/lib/server/dal/jobs'
import { audit } from '@/lib/server/audit'
import { env } from '@/lib/server/env'

export const maxDuration = 120

export async function POST(req: Request) {
  const url = new URL(req.url)
  const jobId = url.searchParams.get('job') ?? ''
  if (!verifyJobToken(jobId, url.searchParams.get('t') ?? '')) return new Response(null, { status: 401 })

  const raw = await req.text()
  if (raw.length > 64_000) return new Response(null, { status: 413 })
  let body: { data?: { taskId?: string; task_id?: string } }
  try { body = JSON.parse(raw) } catch { return new Response(null, { status: 400 }) }
  const taskId = String(body.data?.taskId ?? body.data?.task_id ?? '')       // у Suno — task_id

  const signed = verifyKieWebhook(taskId, req.headers.get('x-webhook-timestamp') ?? '',
                                  req.headers.get('x-webhook-signature') ?? '', env().KIE_WEBHOOK_HMAC_KEY)
  if (!signed) { await audit('kie_webhook_bad_signature', { jobId }); return new Response(null, { status: 401 }) }

  after(() => processFinishedTask(jobId, taskId))   // recordInfo → begin_storing → копия → complete/fail
  return Response.json({ ok: true })                // отвечаем 2xx быстро
}
```

### 5.3. Копирование результатов в Storage (защита от SSRF)

- Ссылки kie живут 14 дней, download-url — 20 минут [K1] §3.4. Копируем **сразу** после `success`.
- Скачиваем только по `https` и только с хостов из allowlist: домены kie / `tempfile.redpandaai.co` из [K1] §3.4. Список сверить на первых ответах. Никаких редиректов на другие хосты, никаких IP-адресов, таймаут 60 с.
- Лимиты размера: картинка ≤ 20 МБ, аудио ≤ 30 МБ, видео ≤ 100 МБ. Тип проверяем по первым байтам файла, а не только по заголовку. Разрешены `image/png|jpeg|webp`, `video/mp4`, `audio/mpeg|wav`.
- Картинки можно пережимать в WebP. `sharp` работает на Vercel, но тогда нужна память функции: вариант на день 4. Это примерно в 4–5 раз меньше места.
- Клиенту отдаём только **подписанную ссылку Supabase** с TTL 1 ч. Ссылки kie клиенту не показываем.

### 5.4. Cron `/api/cron/tick` (раз в минуту, нужен Vercel Pro)

На Hobby cron срабатывает не чаще раза в день, на Pro — раз в минуту, до 100 задач на проект [выдержка] [V4]. Запасной вариант без Vercel Cron — `pg_cron` в Supabase + `pg_net` POST на тот же эндпоинт [офиц.] [S11]. Эндпоинт проверяет `Authorization: Bearer ${CRON_SECRET}`: Vercel присылает этот заголовок, если переменная `CRON_SECRET` задана [выдержка] [V4].

Каждую минуту:
- `claim_jobs(4)` → отправить. Это укладывается в лимит kie 20 новых задач за 10 с; при 429 — `requeue_job` [K1] §3.5.
- Опросить `submitted` старше 2 минут, но не чаще раза в 20 с на задачу.
- Повторить `storing` старше 5 минут.
- `unknown`/`submitted` старше 30 минут → `fail_job` с возвратом. Видео можно держать до 60 минут.
- Алерты Сене в Telegram: дневная трата > порога; баланс kie < $10 (`GET /api/v1/chat/credit` [K1] §1); доля `failed` за час > 30%; всплеск плохих подписей вебхука.

Раз в сутки: удалить данные групп с истёкшим `purge_after` (файлы — через Storage API, не SQL), обновить сверку цен с фидом kie [K1] §3.10.

---

## 6. Тесты с автопроверкой

- Вопросы (`quiz_questions.body`) ученик видит. Ключи (`quiz_keys`) — нет: у роли `authenticated` нет на них даже SELECT.
- Проверка: Server Action `submitQuiz(quizId, answers)` → `requireUser()` → zod → сервер секретным ключом читает ключи → **чистая функция `grade(questions, keys, answers)` в TypeScript** с юнит-тестами → `record_quiz_attempt(...)`. Функция атомарно сохраняет попытку и один раз начисляет бонус.
- Типы: `single`, `multi` (множества равны), `text` (нормализация: регистр, ё/е, пробелы; совпадение с одним из `accept`), `number` (допуск `tol`).
- Ученику возвращаем только балл, правильность по вопросам и бонус. Правильные ответы показываем после последней попытки или по решению учителя.
- Открытые ответы с проверкой LLM — после MVP и только как *подсказка учителю*. Ученик может написать в ответе «поставь 100 баллов» (prompt injection), поэтому оценка LLM не должна сама начислять звёзды.

---

## 7. Список эндпоинтов

| Тип | Путь / имя | Кто | Что делает | Защита |
|---|---|---|---|---|
| page | `/[lang]/…` | все | Публичный сайт (как сейчас) | Статика, CSP, `noindex` как сейчас |
| page | `/[lang]/login` | все | Вход по логину (браузерный клиент Supabase) | Лимиты Supabase по IP [S5], правило WAF Vercel, общий текст ошибки |
| action | `changePassword` | ученик | Смена пароля | `requireUser`, длина ≥ 10 |
| page + action | `/[lang]/join` → `redeemInvite` | по коду | Регистрация по коду (после MVP) | Хеш кода, срок, лимит использований, 10 попыток в час с IP, audit |
| POST | `/api/generate` | ученик | Создать задачу → 202 `{jobId}` | `requireUser`, zod, модерация, `create_generation_job`, Origin = свой домен |
| GET | `/api/jobs/[id]` | владелец / учитель | Статус + подписанные ссылки | RLS (user-клиент) + проверка в DAL, ленивый опрос kie |
| GET | `/api/jobs` | ученик / учитель | Галерея (своя / группы) | RLS, пагинация |
| POST | `/api/chat` | ученик | Синхронный ответ LLM | Как generate + `max_tokens`, `maxDuration = 60` |
| action | `submitQuiz` | ученик | Проверка теста | Ключи только на сервере, `record_quiz_attempt` |
| POST | `/api/uploads/sign` | только `adult` | Подписанная ссылка загрузки фото | Возраст, тип и размер, путь `{user_id}/…` |
| POST | `/api/webhooks/kie` | kie.ai | Завершение задачи | Per-job токен + HMAC + recordInfo, лимит тела |
| GET | `/api/cron/tick` | Vercel Cron | Очередь, повторы, алерты, очистка | `Bearer CRON_SECRET` |
| action | `teacher.createStudents` | учитель | Пачка аккаунтов + 1000 зв., пароли показываются 1 раз | Роль, своя группа, audit |
| action | `teacher.resetPassword` | учитель | Новый пароль ученику | Роль, своя группа, audit |
| action | `teacher.grantStars` | учитель | Начислить / снять звёзды | `grant_stars` (проверка внутри SQL) |
| action | `teacher.setConsent` / `setAgeBand` | учитель | Отметка «согласие родителей получено», возраст | audit. Понизить до `u16` может учитель, повысить до `adult` — только админ |
| action | `teacher.pauseGroup` / `hideJob` | учитель | Стоп генераций группы / скрыть результат | audit |
| action | `teacher.exportStudent` / `deleteStudent` | учитель, админ | Права по DSGVO ст. 15/17 | audit |
| action | `admin.setKillSwitch` / `setPrices` / `setRole` | админ | Глобальный стоп, прайс, роли | MFA, audit |
| GET | `/api/health` | все | Проверка живости | Без данных |

Общее для всех: `import 'server-only'` в DAL; ответы — минимальные DTO; ошибки наружу — коды (`insufficient_stars`), без стектрейсов; для POST `/api/*` проверяем `Origin`. Для Server Actions Next проверяет Origin сам [N3].

---

## 8. Безопасность

### 8.1. Секреты: что, где, кто видит

| Переменная | Откуда | Где хранить | Окружения Vercel |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Connect | Vercel env (не секрет) | Production и Preview — **разные проекты** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | Supabase → Settings → API Keys | Vercel env (публичный по задумке [S2]) | То же |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | Supabase → API Keys → Create secret key | Vercel **Sensitive** | Production — ключ prod. Preview — ключ staging-проекта |
| `KIE_API_KEY` | kie.ai → API Keys | Vercel **Sensitive** | **Только Production**. В Preview не задаём → платформа в mock-режиме |
| `KIE_WEBHOOK_HMAC_KEY` | kie.ai/settings | Vercel Sensitive | Production |
| `KIE_CALLBACK_SECRET`, `CRON_SECRET`, `INVITE_PEPPER`, `IP_HASH_SALT` | `openssl rand -base64 32` | Vercel Sensitive | Production (в Preview — свои значения) |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_CHAT_ID` | @BotFather | Vercel Sensitive | Production |
| `STUDENT_EMAIL_DOMAIN` | `u.<домен>` | Vercel env | Все |
| `SUPABASE_DB_URL` (для дампа) | Supabase → Connect | Только локально или GitHub Actions secret | — |

Правила:
- Значение Sensitive-переменной после создания прочитать нельзя. Режим доступен для Production и Preview, но не для Development [выдержка] [V8].
- **Preview не получает ключ kie.** Каждая ветка `claude/*` и каждый PR создают preview-деплой. Если ключ kie в Preview есть, любой код из ветки может его потратить.
- Локально `.env.local` уже в `.gitignore` (`.env*`). Туда кладём только ключи **staging**-проекта.
- **Репозиторий `simonspivak/workshop` публичный** (проверено через GitHub API). Всё, что в нём лежит — SQL, политики, будущие тексты уроков — видит любой. Безопасность не должна держаться на секретности кода. Секреты в git попадать не должны (8.10).
- Главная копия всех секретов — менеджер паролей (Bitwarden или 1Password). Не в Telegram, не в Google Docs, не в заметках n8n, не в чате с ИИ.
- Ротация: в Supabase можно иметь несколько секретных ключей — создать новый, задеплоить, удалить старый [S2]. Ротацию ключа kie проверить в кабинете [не проверено].
- На балансе kie держим только нужную сумму и пополняем частями: при утечке ключа ущерб ограничен остатком [K1] §4.6.

### 8.2. Правила кода (из документации Next.js 16)

- В клиентских компонентах (`'use client'`) нет импортов из `lib/server/**`. `import 'server-only'` даст ошибку сборки при нарушении [N3].
- `process.env` читает только `lib/server/env.ts`, лениво (не на этапе импорта, чтобы не ломать пререндер), с проверкой zod.
- Каждая Server Action и каждый Route Handler начинается с `requireUser()` / `requireRole()`. Затем проверка, что ресурс принадлежит пользователю или его группе (IDOR). Затем zod-схема со `.strict()` против подстановки лишних полей (mass assignment).
- Возвращаем только нужные поля. Server Components не передают в клиент целые строки БД [N3].
- `searchParams`, `params` и заголовки — пользовательский ввод. Параметр `next` при редиректе после входа — только относительный путь своего домена (защита от open redirect) [N8].
- Не писать мутации в рендере: только через Actions и POST [N3].
- Ошибки: наружу код, внутрь — лог без ПДн. Любое неожиданное исключение в денежном пути означает «ничего не списано» или «возврат» (OWASP A10).

### 8.3. Rate limiting — четыре слоя

| Слой | Что | Где |
|---|---|---|
| 1. Vercel WAF | Правило на `/api/*`: 60 запросов в минуту с IP. Правило на `/login` и `/join`. WAF Rate Limiting есть на всех тарифах, на Hobby мало пользовательских правил (по разным источникам 1–3) [выдержка] [V5] | Дашборд Vercel |
| 2. Supabase Auth | Встроенные лимиты по IP: токены 150 за 5 мин, всплеск 30 [офиц.] [S5] | Authentication → Rate Limits |
| 3. Приложение, на пользователя | Баланс, дневной лимит (300 зв.), ≤ 3 задачи в работе — **внутри `create_generation_job`**, атомарно. Опрос статуса не чаще раза в 3 с; kie сервер дёргает не чаще раза в 20 с на задачу | SQL + DAL |
| 4. Группа и глобально | Дневной лимит группы, глобальный дневной лимит, рубильник `generation_enabled`, кнопка «пауза группы». Отправка в kie ≤ 4 параллельно (лимит kie 20 за 10 с [K1] §3.5) | SQL + cron |

Отдельный Redis (Upstash, бесплатно 500 тыс. команд в месяц [3-я сторона] [U1]) на старте **не нужен**: лимиты считает Postgres в той же транзакции, что и списание, и обработчиков данных меньше. Понадобится при сотнях одновременных пользователей.

### 8.4. Вебхуки

Раздел 5.2: per-job токен + HMAC + перезапрос recordInfo, ответ 2xx быстро, идемпотентность, лимит тела 64 КБ, audit плохих подписей. Будущий Telegram-бот: проверять заголовок `X-Telegram-Bot-Api-Secret-Token` (параметр `secret_token` в `setWebhook`). Токен бота — только на сервере.

### 8.5. CSP и заголовки

Nonce-CSP требует динамического рендера всех страниц и несовместим с PPR [N6]. А в `next.config.ts` включены `cacheComponents` и `partialPrefetching`. Поэтому — статичная CSP в `headers()`, как в разделе «Without Nonces» документации [N6]. Позже можно попробовать экспериментальный SRI, который позволяет убрать `'unsafe-inline'` у скриптов [N6].

```ts
// next.config.ts — добавить к существующему headers()
const isDev = process.env.NODE_ENV === 'development'
const SUPABASE = 'https://<project-ref>.supabase.co'
const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: ${SUPABASE};
  media-src 'self' blob: ${SUPABASE};
  connect-src 'self' ${SUPABASE};
  font-src 'self';
  frame-src https://calendar.google.com;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests;`.replace(/\s{2,}/g, ' ').trim()

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },      // уже есть сейчас
]
```

- `frame-src calendar.google.com` нужен для встроенного календаря записи (`content/config.ts`). Если появится урок с микрофоном, поменять на `microphone=(self)`.
- `'unsafe-inline'` для скриптов ослабляет CSP. Поэтому главная защита от XSS — **никогда не вставлять HTML от пользователя или LLM** (`dangerouslySetInnerHTML` запрещён). Markdown из ответов LLM рендерить без сырого HTML. Картинки из ответов LLM не подгружать автоматически: через них возможна утечка данных при prompt injection. `img-src` это тоже блокирует.

### 8.6. Prompt injection и злоупотребления (OWASP LLM Top 10)

Главный принцип: **LLM не принимает решений с последствиями**. Деньги, права, модель, цена и лимиты определяет код и SQL, а не текст модели.

| Угроза | Мера |
|---|---|
| Ученик пишет «игнорируй правила» в генераторе | Модель, цена и параметры — из whitelist на сервере. Клиент передаёт только `action`, `prompt` (≤ 1000 символов) и опции из enum. Произвольный `model`/`input` в kie не попадает (LLM01, LLM10) |
| Обход модерации внедрением в текст | Три независимых слоя: стоп-слова (ru/uk/ro/en/de, без LLM) → поиск ПДн → LLM-классификатор. Текст ученика у классификатора в разделителях, ответ — JSON по схеме, для младших fail-closed (LLM01) |
| Утечка системного промпта | В системных промптах нет ключей, ссылок и внутренних данных (LLM07). У kie свои скрытые промпты на LLM-маршрутах, поэтому всегда передаём свои `instructions`/`system` [K1] §5 |
| Небезопасный вывод | Ответ LLM — только текст. Не HTML, не команды, не URL для автозагрузки (LLM05) |
| «Агент» с инструментами | В MVP у агентов учеников нет инструментов, которые тратят деньги или пишут в БД. В уроке про агентов — песочница: свой лимит звёзд, allowlist инструментов, подтверждение человеком (LLM06) |
| Неограниченное потребление | `max_tokens`, таймауты, ≤ 3 задачи в работе, дневные лимиты, глобальный рубильник, небольшой баланс kie (LLM10) |
| Утечка ПДн в поставщиков | Блокируем телефоны, e-mail, адреса в промптах. Младшим нельзя загружать фото. Учеников просим не писать настоящие имена (LLM02) |
| Цепочка поставок моделей | Модели только из whitelist, мониторинг пропавших моделей и фолбэки [K1] §3.9 (LLM03) |

Если очень нужна бесплатная внешняя модерация, есть OpenAI `omni-moderation` (бесплатна, текст и картинки) [3-я сторона] [O3]. Но это ещё один американский обработчик данных детей и отдельный аккаунт. На старте хватит LLM-классификатора через kie, он уже обработчик.

### 8.7. Безопасный режим для несовершеннолетних

Включается **автоматически** для `age_band ≠ 'adult'`. Выключить его не может ни ученик, ни учитель. Изменить возраст на `adult` может только админ.

| Что | Младшие (`u16`, `16_17`) | Взрослые |
|---|---|---|
| Генерации до отметки согласия родителей | **Запрещены в БД** (`consent_missing`) | — |
| Модели | Только `price_list.minors_ok = true`. Без Grok. Google-модели — решение Сени (ограничение Google 18+, [K1] §3.8) | Все из whitelist |
| Загрузка своих фото и видео, lip sync с реальным лицом | Нет. Только персонажи и ролики из библиотеки курса | Да, с лимитами |
| Видео | 480p, ≤ 10 с или только демо учителя [K1] §6 | Как в прайсе |
| Модерация промпта | Стоп-слова + ПДн + LLM, fail-closed | Стоп-слова + LLM, fail-open с логом |
| Пост-модерация картинок | Vision-LLM до показа (~0.02–0.05 кр, [K1] §3.7) | Выборочно |
| `nsfw_checker: true` | Везде, где есть [K1] §3.6 | Везде |
| Чат-тьютор | Системный промпт «для подростков», без романтических ролевых игр, не спрашивает ПДн, сообщает, что он ИИ | Обычный |
| Признаки самоповреждения | Не просто отказ: показать телефон доверия 116 111 (Молдова, Германия, Украина — проверить актуальность) и уведомить учителя | То же |
| Публикация результатов вне платформы | Только с отдельной галочкой в согласии родителей | Сам решает |

Учитель видит все промпты и результаты группы, может скрыть результат и поставить группу на паузу. Ученик может пожаловаться кнопкой. Все отказы модерации пишутся в `audit_log` (храним 90 дней).

### 8.8. Логирование и мониторинг

- **Логи Vercel короткие:** 1 час на Hobby, 1 день на Pro, 30 дней с Observability Plus. Log Drains — только на Pro [выдержка] [V9]. Логи Supabase: 1 день на Free, 7 дней на Pro [офиц.] [S1]. Поэтому **журнал безопасности ведём в своей БД** (`audit_log`), а `jobs` и `star_ledger` — полная история генераций и денег.
- В логи Vercel пишем структурированный JSON без паролей, ключей, полных промптов и IP (только хеш с солью).
- Алерты в Telegram Сене через cron (5.4). Sentry (EU, `de.sentry.io`) — по желанию: это ещё один обработчик данных, тогда указать его в Datenschutzerklärung.

### 8.9. Бэкапы

| Что | Как | Частота |
|---|---|---|
| Схема | `supabase/migrations/*.sql` в git | Каждое изменение |
| БД | Supabase Pro: ежедневно, хранится 7 дней. На Free автоматических бэкапов нет [офиц.] [S8], [S1] | Ежедневно |
| БД, вторая копия | `supabase db dump` (логический дамп) → шифровать (`age`/`gpg`) → Google Drive Сени. Supabase сам советует Free-проектам регулярно выгружать данные [офиц.] [S8] | Раз в неделю и перед каждым курсом |
| Файлы Storage | **В бэкапы БД не входят** [офиц.] [S8]. Результаты учеников можно перегенерировать, ценность низкая; удаляются по сроку хранения | — |
| PITR | $100/мес за 7 дней, нужен Small compute [офиц.] [S1], [S8] | Не нужно |

**Не выкладывать дампы артефактами GitHub Actions в публичном репозитории** и не коммитить их. Если делать GitHub Action — шифровать до загрузки. Один раз прогнать восстановление на staging.

### 8.10. GitHub

- **Secret scanning + push protection** бесплатны для публичных репозиториев [выдержка] [G1]. Включить в Settings → Code security. Для приватного личного репозитория push protection без платных продуктов недоступна [3-я сторона]. Это довод оставить репозиторий публичным, но тогда уроки и SQL тоже открыты. Решение за Сеней.
- **Dependabot alerts + security updates**, плюс `.github/dependabot.yml` для npm раз в неделю с группировкой minor/patch [выдержка] [G1].
- **CodeQL default setup** (бесплатно для публичных репозиториев) [не проверено в этом исследовании].
- **Ruleset для `main`:** только через PR, обязательные проверки (lint, typecheck, build, `supabase test db`), без force-push. Ветки `claude/*` идут только через PR.
- GitHub Actions: `permissions: contents: read` по умолчанию, actions закреплены по SHA, секреты не доступны PR из форков.
- Private vulnerability reporting + `SECURITY.md`.
- `npm ci` + lockfile, `npm audit --omit=dev` в CI, минимум зависимостей (OWASP A03).
- 2FA везде: GitHub, Vercel, Supabase, kie, Google, Telegram.

### 8.11. Чеклист OWASP Top 10:2025 [O1] + LLM Top 10 [O2]

| Риск | Что делаем | Готово к запуску, если… |
|---|---|---|
| A01 Broken Access Control | DAL + RLS + у клиентов нет прав на запись; проверка группы учителя; тесты pgTAP | Ученик Б по токену ученика А не видит и не меняет чужое (тест 4.4 + ручной тест через Data API) |
| A02 Security Misconfiguration | Регистрация выключена; авто-экспонирование таблиц выключено; `revoke` функций; CSP/заголовки; Preview без ключа kie | Скрипт проверки default privileges [S3] возвращает 0 строк |
| A03 Software Supply Chain | Dependabot, lockfile, `npm audit`, actions по SHA | Нет high/critical алертов |
| A04 Cryptographic Failures | HTTPS/HSTS; пароли хеширует Supabase; секреты 32 байта; HMAC с постоянным временем сравнения | — |
| A05 Injection | Supabase-клиент и параметры RPC (без склейки SQL); zod; React-экранирование; без `dangerouslySetInnerHTML` | — |
| A06 Insecure Design | Инварианты в БД; idempotency; лимиты; безопасный режим по умолчанию (`u16`) | — |
| A07 Authentication Failures | Длинные пароли; MFA учителей; лимиты по IP; `getClaims()`, а не `getSession()` | — |
| A08 Software/Data Integrity | Подпись вебхука + перезапрос; журнал только дописывается; миграции в git | — |
| A09 Logging & Alerting | `audit_log`, `jobs`, `star_ledger`; алерты в Telegram | Тестовый алерт дошёл |
| A10 Exceptional Conditions | Любая ошибка в денежном пути = «не списано» или «возврат»; `unknown` не повторяется; таймауты | Тест «kie упал на середине» вернул звёзды |
| LLM01/05/06/07/10, LLM02/03 | Раздел 8.6 | Набор из 30 «плохих» промптов на 3 языках заблокирован |

---

## 9. Право и деньги

### 9.1. Vercel Hobby или Pro

- Условия Vercel: «Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan». Коммерческим считается «any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production of the project». В примерах: приём оплаты от посетителей, **реклама продажи продукта или услуги**, оплата за создание или хостинг сайта [выдержка] [V1]. Ответ сотрудника Vercel на форуме: прототип на Hobby можно, но как только берёте или собираетесь брать деньги — переходите на Pro [выдержка] [V1].
- **Вывод:** сайт рекламирует платные воркшопы Сени, платформа обслуживает платные курсы. Нужен **Pro**. Это касается уже нынешнего сайта.
- Pro: **$20/мес за место, $20 кредита на использование в месяц включено** [3-я сторона] [V2]. Функции до 800 с, cron раз в минуту, Log Drains, больше правил WAF [выдержка] [V3], [V4], [V5], [V9]. Hobby при превышении лимитов ставится на паузу, докупить использование нельзя [3-я сторона] [V2].
- Регион функций по умолчанию `iad1` (Вашингтон). Переключить на `fra1`: настройки проекта или `vercel.json` → `"regions": ["fra1"]` [выдержка] [V6]. Сборка может идти в другом регионе, это нормально [V6].
- DPA Vercel: `vercel.com/legal/dpa`. Применяется, когда данные клиента подпадают под GDPR, Vercel выступает как processor [выдержка] [V7]. Охватывает ли он Pro без отдельной подписи, источники описывают по-разному — проверить на странице [не проверено].

### 9.2. Лимиты и цены

**Supabase** (прайс-данные с сайта, 01.11.2026) [офиц.] [S1]:

| | Free ($0) | Pro ($25/мес, один проект на Micro включён) |
|---|---|---|
| База | 500 МБ, общий CPU, 500 МБ RAM | 8 ГБ диска, затем $0.125/ГБ |
| Файлы (Storage) | 1 ГБ, файл ≤ 50 МБ | 100 ГБ, затем $0.0213/ГБ |
| Трафик | 5 ГБ + 5 ГБ кешированного | 250 ГБ + 250 ГБ, затем $0.09 / $0.03 за ГБ |
| Пользователи | 50 000 MAU | 100 000 MAU, затем $0.00325 |
| Пауза | **После 1 недели без активности**, максимум 2 активных проекта | Никогда |
| Бэкапы | **Нет** | Ежедневные, 7 дней |
| Логи | 1 день | 7 дней |
| Утёкшие пароли (HIBP) | Нет | Да |
| Edge Functions | 500 тыс. вызовов | 2 млн |

**Vercel** [выдержка]/[3-я сторона] [V2], [V3], [V4], [V9]:

| | Hobby ($0, **только некоммерческое**) | Pro ($20/место/мес, $20 кредита) |
|---|---|---|
| Трафик / вызовы / CPU | 100 ГБ / 1 млн / 4 ч Active CPU в месяц | 1 ТБ трафика, дальше по использованию |
| Длительность функции | до 300 с | 300 с по умолчанию, до 800 с |
| Cron | раз в день | раз в минуту |
| Логи | 1 час | 1 день |
| Тело запроса функции | 4.5 МБ (на всех тарифах) | 4.5 МБ |

**Итого в месяц** (без kie):
- Пилот: Vercel Pro $20 + Supabase Free $0 = **~$20**. Минусы: нет бэкапов (компенсируем еженедельным дампом), пауза через неделю простоя, 1 ГБ под файлы.
- Рабочий режим: Vercel Pro $20 + Supabase Pro $25 = **~$45** (~42 €).
- Staging-проект на Free. Тариф Supabase, вероятно, действует на уровне организации, поэтому staging держать в отдельной бесплатной организации [не проверено].
- Генерации kie — отдельно, см. [K1] §4: ~52 € на 15 учеников за курс.

**Хватит ли 1 ГБ Storage на курс.** На ученика за 4 урока ~40 картинок × 1.5 МБ + 5 треков × 4 МБ + 3 видео × 5 МБ ≈ 95 МБ. На 15 учеников ≈ **1.4 ГБ — больше Free**. В WebP картинки займут ~0.3 МБ, тогда ≈ 0.7 ГБ. Это грубая оценка. Вывод: на время курса взять Pro или пережимать и удалять оригиналы через 30 дней.

### 9.3. DSGVO / GDPR в Германии

**Кто отвечает.** Сеня работает из Германии, поэтому GDPR применяется ко всей обработке на платформе, включая участников из Молдовы и Украины (ст. 3(1) GDPR). Практичная схема: **Сеня — контролёр (Verantwortlicher) платформы**. Клуб — партнёр, который собирает согласия родителей и раздаёт карточки; это фиксируется короткой письменной договорённостью. Альтернатива — клуб контролёр, Сеня обработчик с AV-Vertrag по ст. 28. Это сложнее, и клубу в Молдове трудно выполнить требования GDPR.

**Что нужно до запуска:**

| Документ | Суть | Источник |
|---|---|---|
| **Impressum по §5 DDG** | С 14.05.2024 DDG заменил TMG, содержание почти то же. Имя; ladungsfähige Anschrift — адрес, по которому можно вручить документы (не абонентский ящик); быстрый электронный контакт (e-mail + второй канал); USt-IdNr или W-IdNr, если есть. Steuernummer не указывать. Ссылку на ODR-платформу ЕС убрать (портал закрыт в 2025). Impressum должен быть легко узнаваем, открываться сразу и быть доступен всегда: в футере сайта и платформы, ссылкой в описании Telegram-канала и бота | [выдержка] [L2] |
| §18 Abs. 2 MStV | Если канал «Сияй-сияй» и блог публикуют новости — нужен ответственный за редакционное содержание | [не проверено, проверить у юриста] [L8] |
| **Datenschutzerklärung** (ст. 13) | Кто контролёр; какие данные (логин-псевдоним, возрастная группа, промпты, результаты, журнал звёзд, тесты, хеш IP); цели; правовые основания; **обработчики: Vercel (США), Supabase (Frankfurt, компания из США), kie.ai и поставщики моделей (Google, ByteDance, Anthropic и др., США/Китай)**; передача в третьи страны (DPF/SCC); сроки хранения; права; жалоба в надзорный орган; ИИ-обработка. Нынешний `content/privacy.ts` дополнить **до** запуска (это уже записано в README) | ст. 13, 44 ff. GDPR [L3] |
| **AV-Vertrag / DPA** (ст. 28) | Supabase — подписать в дашборде (Legal documents → PandaDoc) [S10]. Vercel — DPA на сайте [V7]. **kie.ai — DPA не найден** [K1] §3.8: запросить. Пока его нет — не отправлять в kie персональные данные: фото, имена, голоса реальных людей | [S10], [V7], [K1] |
| VVT (ст. 30) | Простой реестр обработок (1–2 страницы). Освобождение для малых предприятий не действует, если обработка не разовая | ст. 30 GDPR [L3] |
| TOMs (ст. 32) | Раздел 8 этого отчёта = основа описания мер | — |
| DSFA (ст. 35) | Данные детей + ИИ + новые технологии → **рекомендую короткую оценку воздействия**, чтобы быть на безопасной стороне | ст. 35 GDPR [L3] |
| Инциденты (ст. 33) | Утечка → уведомить надзорный орган в течение 72 часов. Нужен план: кто, что, куда | ст. 33 GDPR [L3] |
| Удаление | Данные группы удаляются через 90 дней после конца курса (`purge_after`), журнал звёзд обезличивается. Экспорт и удаление по запросу — кнопки учителя | ст. 5(1)(e), 15, 17 |

**Возраст согласия.** Ст. 8 GDPR: при обработке на основании согласия для онлайн-сервиса, предлагаемого ребёнку напрямую, ребёнок до 16 лет согласие сам дать не может. Германия порог не снижала. Нужно согласие родителей, либо согласие ребёнка с одобрения родителей [выдержка] [L1]. Вне ст. 8 жёсткого возраста нет, оценивается способность ребёнка понимать последствия [L1].

### 9.4. Что делать с учениками 14–15 лет (и вообще до 18)

Рекомендация: **письменное согласие родителей для всех младше 18.** Для 14–15 лет это обязательно по ст. 8. Для 16–17 это нужно из-за условий Google (18+ для сервисов, которыми пользуются несовершеннолетние, [K1] §3.8), Telegram (18+ в ЕС) и для спокойствия клуба.

1. Клуб раздаёт родителям **форму согласия на RO/RU** (вариант на UA для украинских семей). Что в ней: кто Сеня и как с ним связаться; какие данные (псевдоним, возрастная группа, промпты, результаты; без фото, e-mail и телефона); зачем; какие сервисы и в каких странах (включая ИИ-поставщиков в США и Китае); срок хранения (90 дней после курса); права и отзыв согласия. Галочки:
   - (а) аккаунт и генерации на уроках — обязательно;
   - (б) показ работ группе в Zoom — по желанию;
   - (в) публикация работ в каналах Сени — отдельно, по желанию.
2. Подписанные формы хранит клуб. Сеня получает список или сканы. Учитель ставит в админке отметку `parental_consent_at`. **До отметки БД не даёт генерировать** (`consent_missing`).
3. При первом входе — простое объяснение «что происходит с твоими данными» (ст. 12(1): понятным ребёнку языком) и что тьютор — ИИ (AI Act, ст. 50).
4. Минимум данных: ник вместо имени, нет e-mail, телефона и даты рождения — только возрастная группа.
5. Безопасный режим принудительно (8.7). Своих фото не загружать.
6. Telegram для младших не обязателен: уведомления внутри платформы (9.6).

### 9.5. Молдова и Украина кратко

- **Молдова.** Закон № 195/2024 о защите персональных данных вступил в силу **23.08.2026**. Он во многом повторяет GDPR, штрафы вводятся постепенно: 10% в первый год, 40% во второй, 100% с третьего [выдержка] [L4]. Надзор — Национальный центр защиты персональных данных (datepersonale.md). Возраст самостоятельного согласия ребёнка в законе я подтвердить не смог [не проверено]. Практически: клуб как местный организатор собирает согласия родителей на всех младше 18 — это закрывает и молдавские, и немецкие требования.
- **Украина.** Действует Закон № 2297-VI «Про захист персональних даних» (2010), он старше GDPR. Новый закон (проект № 8153) прошёл первое чтение 20.11.2024; на середину 2026 года, по найденным источникам, окончательно не принят [выдержка] [L5]. Отдельного возраста согласия ребёнка в законе нет. На практике требуют согласие родителей [выдержка] [L5]. Украинцы, живущие в Германии, — под GDPR в любом случае.

### 9.6. AI Act и Telegram

- **AI Act, ст. 50** (прозрачность) применяется **с 02.08.2026**, Digital Omnibus её не отложил. Отложены обязательства для высокорисковых систем (до 02.12.2027). Для маркировки контента генеративными системами, которые уже на рынке, — льготный период до 02.12.2026 [выдержка] [L6]. Для платформы: тьютор сообщает «я ИИ». В уроках про Reels учим помечать ИИ-контент; дипфейки с реальными людьми запрещены правилами курса.
- **Telegram:** по условиям, в ЕС, Великобритании и Австралии пользователю нужно **18+** (Австралию добавили в январе 2026) [выдержка] [L7]. Значит, «после выбора формата — переход в Telegram» подходит взрослым группам: пенсионеры, корпоративные, взрослые индивидуальные. Для подростков из ЕС — только платформа и e-mail родителей. Для Молдовы (не ЕС) правило Telegram проверить отдельно [не проверено].

---

## 10. План на 4 дня (MVP)

**В MVP входит:** вход по логину, роли, учитель создаёт группу и учеников, звёзды с журналом, 4 действия (картинка, чат, музыка или голос, тест), очередь с вебхуком и повторами, копирование в Storage, галерея, 4 урока-заготовки на русском, тесты, безопасный режим, заголовки и CSP, бэкапы, юридические страницы.
**Не входит:** видео, lip sync и motion для учеников (только демо учителя), коды приглашения (если не останется времени), полный перевод UI на 4 языка (словари заготовлены), Telegram-бот, CRM, загрузка своих фото.

| День | Задачи | Результат к вечеру |
|---|---|---|
| **0 (Сеня, ~2 ч, до старта)** | Раздел 11: аккаунты, регион, ключи, Vercel Pro, kie HMAC-ключ, домен | Все ключи в Vercel Sensitive, staging и prod созданы |
| **1. Фундамент и вход** | Миграция 0001 (4.1–4.3) + pgTAP (4.4); выключить регистрацию и авто-экспонирование; `@supabase/ssr` + `proxy.ts` (`getClaims`); DAL `requireUser/requireRole`; страница входа; кабинет учителя: создать группу + пачку учеников + печать карточек; заголовки и CSP; `vercel.json` (`fra1`, cron); GitHub security | Учитель создал 3 тестовых ученика, ученик вошёл и видит баланс 1000; тесты RLS зелёные |
| **2. Звёзды и генерации** | `price_list` (дешёвые модели из [K1] §0); `/api/generate` + zod + модерация (стоп-слова, ПДн, LLM); kie-адаптеры: `image.basic`, `chat.msg`, `music.track` или `tts`; вебхук (5.2) + `recordInfo`; копирование в Storage; `/api/jobs/[id]` с ленивым опросом; cron tick; возвраты; рубильник; алерты | Картинка и трек проходят полный цикл; при искусственном fail звёзды возвращаются; двойной клик не списывает дважды |
| **3. Уроки, тесты, учитель** | Уроки в `content/lessons/ru/*` (4 заготовки с «генератором» на шаге); тесты + `grade()` + `record_quiz_attempt` + бонус; галерея; кабинет учителя: траты группы, скрыть результат, пауза, сброс пароля, начисление звёзд, отметка согласия; безопасный режим младших | Пройден урок 1 целиком под учеником `u16` с согласием; учитель видит всё по группе |
| **4. Защита, право, запуск** | Ручной пентест: ученик Б против данных А (Data API с JWT), подделка и повтор вебхука, 30 плохих промптов на ru/ro/uk, 15 одновременных генераций; правило Vercel WAF; дамп + проверка восстановления; Impressum, Datenschutzerklärung (+ платформа), форма согласия RO/RU; хранение и удаление; генеральная репетиция с 3 тестовыми аккаунтами | Чеклист 8.11 закрыт; документы опубликованы; карточки для клуба готовы |

Запас прочности: если день 2 затянется (адаптеры kie капризны: поля у моделей разные [K1] §3.1), в MVP оставить картинку и чат, а музыку перенести.

---

## 11. Что делает сам Сеня (и куда класть ключи)

1. **Supabase** (supabase.com):
   - Аккаунт с 2FA.
   - Организация «prod»: проект в регионе **«Central EU (Frankfurt)»** — именно конкретный регион, не общий «Europe» [S9].
   - Отдельная бесплатная организация «staging»: второй проект там же.
   - В каждом проекте: Settings → API Keys → создать **publishable** и **secret** ключи; старые `anon`/`service_role` не использовать [S2].
   - Authentication → выключить «Allow new users to sign up» и «Anonymous sign-ins»; минимальная длина пароля 10 [S12].
   - Data API settings → выключить «Automatically expose new tables» [S3].
   - Legal documents → запросить и подписать **DPA** [S10].
   - Решить: Free на пилот или Pro на время курса.
2. **Vercel:**
   - Перейти на **Pro** (сайт коммерческий).
   - Project → Functions → регион `fra1`.
   - Environment Variables: всё из таблицы 8.1, секреты с галочкой **Sensitive**, ключ kie — **только Production**.
   - Включить Spend Management (лимит трат) и защиту preview-деплоев (Deployment Protection) [не проверено, какие настройки включены по умолчанию].
3. **kie.ai:**
   - Решить: отдельный аккаунт под платформу (рекомендую: свой баланс, свой ключ, утечка не затронет n8n) или общий с n8n.
   - Включить 2FA, если есть.
   - Settings → создать **Webhook HMAC key** [K1] §3.3.
   - Пополнять частями (например, по $50).
   - Написать в поддержку: где хранятся данные, есть ли **DPA**.
4. **GitHub** (репозиторий публичный): Settings → Code security → secret scanning, push protection, Dependabot alerts и security updates, CodeQL default; ruleset для `main`; 2FA. Решить: оставить публичным или сделать приватным (тогда тексты уроков закрыты, но бесплатного push protection для личного приватного репозитория нет).
5. **Секреты сгенерировать локально:** `openssl rand -base64 32` для `KIE_CALLBACK_SECRET`, `CRON_SECRET`, `INVITE_PEPPER`, `IP_HASH_SALT`. Сохранить в менеджер паролей, вставить в Vercel. **Никогда** не присылать ключи в чат (ни Claude, ни Telegram), не класть в Google Drive, не коммитить. Если ключ kie когда-либо попадал в экспорт workflow n8n или в скриншот — перевыпустить.
6. **Домен:** нужен для `STUDENT_EMAIL_DOMAIN` (поддомен `u.` без MX) и для Impressum и писем. Привязать к Vercel.
7. **Telegram:** бот для алертов (@BotFather), его токен — в Vercel Sensitive.
8. **Юридическое:**
   - Данные для Impressum: адрес для вручения, контакты, USt-IdNr или пометка про Kleinunternehmer.
   - Подтвердить список обработчиков.
   - Согласовать с клубом форму согласия и кто хранит подписанные формы.
   - Решить срок хранения (рекомендую 90 дней).
   - По желанию — час консультации юриста по DSGVO для детей (оценка воздействия, согласие).
9. **Контент:** 4 урока (тексты на русском), 1 тест на урок, запасные готовые примеры на каждый шаг (на случай ложных отказов модерации [K1] §5).

---

## 12. Риски и открытые вопросы

- **kie.ai без DPA и с неизвестным местом хранения.** Самая слабая точка по GDPR. Минимизация: без фото и имён, фильтр ПДн. Плюс запрос DPA.
- **Google-модели и несовершеннолетние** (условия Gemini API, 18+) — см. [K1] §3.8, решение за Сеней.
- **Технические e-mail.** Это рабочий, но обходной приём [S14]: письма невозможны, сброс пароля — только учителем. Если Supabase начнёт отвергать «немаршрутизируемые» домены, нужен свой поддомен (он и рекомендован).
- **Supabase Free:** пауза через неделю простоя и нет бэкапов. Для живого курса лучше Pro.
- **Публичный репозиторий:** всё видно. Ошибочный коммит секрета ловит push protection, но не всё.
- **Supabase меняет умолчания** (отключение старых ключей к концу 2026, переход к «экспонированию по запросу» [S2], [S3]). Следить за changelog.
- **Модерация:** ложные отказы на уроке и пропуски. Нужны запасные примеры и ручной контроль учителя.
- **Сроки:** 4 дня реальны только при жёстком объёме MVP (раздел 10). Видео и lip sync для учеников — после.
- **Непроверенное:** точные цифры Vercel (официальный сайт недоступен); возраст согласия в Молдове; статус нового закона в Украине; правило Telegram для Молдовы; применимость DPA Vercel к Pro; домены результатов kie.

---

## 13. Источники

**Next.js 16.4.3 (локальная документация проекта, `node_modules/next/dist/docs/`)**
- [N1] `01-app/01-getting-started/16-proxy.md` — Proxy вместо Middleware, назначение и ограничения
- [N2] `01-app/01-getting-started/15-route-handlers.md` — Route Handlers, кеширование, Cache Components
- [N3] `01-app/02-guides/data-security.md` — DAL, `server-only`, taint, безопасность Server Actions, CSRF/Origin, IDOR, аудит
- [N4] `01-app/02-guides/authentication.md` — сессии, cookie, оптимистичные проверки в Proxy, библиотеки авторизации; `03-api-reference/04-functions/forbidden.md`
- [N5] `01-app/02-guides/authentication-with-cache-components.md` — `use cache: private`, ловушки с ключами кеша
- [N6] `01-app/02-guides/content-security-policy.md` — nonce требует динамики, несовместим с PPR; CSP без nonce; SRI
- [N7] `01-app/02-guides/environment-variables.md` — `NEXT_PUBLIC_` встраивается в бандл
- [N8] `01-app/02-guides/backend-for-frontend.md` — webhooks, rate limiting, проверка ввода, open redirect
- [N9] `01-app/03-api-reference/03-file-conventions/proxy.md` — Node.js runtime по умолчанию, Server Functions и matcher
- [N10] `01-app/03-api-reference/04-functions/after.md` — `after()` и `waitUntil` на Vercel
- [N11] `01-app/02-guides/internationalization.md` — маршруты `/[lang]`, редирект в Proxy
- [N12] `01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md`, `maxDuration.md`
- [N13] `01-app/02-guides/production-checklist.md` — раздел Security

**Supabase (официальная документация, исходники из `github.com/supabase/supabase`, master `a05e7ec`, 01.11.2026)**
- [S1] Тарифы и лимиты: https://supabase.com/pricing (данные: https://github.com/supabase/supabase/blob/master/packages/shared-data/plans.ts , https://github.com/supabase/supabase/blob/master/packages/shared-data/pricing.ts)
- [S2] API keys (publishable/secret, отключение legacy-ключей к концу 2026): https://supabase.com/docs/guides/getting-started/api-keys
- [S3] Securing your API (default privileges, «Automatically expose new tables», EXECUTE для PUBLIC): https://supabase.com/docs/guides/api/securing-your-api
- [S4] Row Level Security (security definer, `user_metadata`, тесты): https://supabase.com/docs/guides/database/postgres/row-level-security
- [S5] Auth rate limits (лимиты по IP, `Sb-Forwarded-For`): https://supabase.com/docs/guides/auth/rate-limits
- [S6] Password security: https://supabase.com/docs/guides/auth/password-security
- [S7] Server-side клиент для Next.js (`proxy.ts`, `getClaims()`): https://supabase.com/docs/guides/auth/server-side/creating-a-client
- [S8] Backups: https://supabase.com/docs/guides/platform/backups
- [S9] Regions: https://supabase.com/docs/guides/platform/regions
- [S10] GDPR и DPA: https://supabase.com/docs/guides/security/gdpr-compliance , https://supabase.com/legal/dpa
- [S11] Queues / Cron / pg_net: https://supabase.com/docs/guides/queues , https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/database/extensions/pg_net
- [S12] Auth general configuration (выключение регистрации): https://supabase.com/docs/guides/auth/general-configuration
- [S13] `auth.admin.createUser` (`email_confirm`): https://supabase.com/docs/reference/javascript/auth-admin-createuser
- [S14] Обсуждение входа по username: https://github.com/supabase/supabase/discussions/16619
- [S15] Passwords (e-mail или телефон): https://supabase.com/docs/guides/auth/passwords

**Vercel (выдержки поиска; vercel.com из этой среды недоступен)**
- [V1] Fair use guidelines: https://vercel.com/docs/limits/fair-use-guidelines ; https://vercel.com/kb/guide/why-is-my-account-deployment-blocked ; https://vercel.com/docs/plans/hobby ; форум: https://community.vercel.com/t/fair-use-of-the-hobby-plan/2725
- [V2] Тарифы: https://vercel.com/docs/plans ; [3-я сторона] https://makerkit.dev/blog/saas/vercel-cost , https://livemy.app/blog/vercel-pricing
- [V3] Ограничения функций: https://vercel.com/docs/functions/limitations
- [V4] Cron: https://vercel.com/docs/cron-jobs/usage-and-pricing ; https://vercel.com/docs/cron-jobs/manage-cron-jobs
- [V5] WAF rate limiting: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- [V6] Регионы функций: https://vercel.com/docs/functions/configuring-functions/region ; https://github.com/vercel/next.js/discussions/50282
- [V7] DPA: https://vercel.com/legal/dpa
- [V8] Sensitive environment variables: https://vercel.com/docs/projects/environment-variables/sensitive-environment-variables
- [V9] Логи: https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/log-drains
- [V10] Лимит тела 4.5 МБ: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions

**Firebase и альтернативы**
- [F1] Cloud Storage только на Blaze с 03.02.2026: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- [F2] Custom tokens: https://firebase.google.com/docs/auth/admin/create-custom-tokens
- [F3] Firestore pricing: https://cloud.google.com/firestore/pricing
- [A1] Better Auth (прочитано из `github.com/better-auth/better-auth`, npm latest 1.7.15): https://better-auth.com/docs/plugins/username , https://better-auth.com/docs/plugins/admin , https://better-auth.com/docs/concepts/rate-limit
- [A2] Neon Free: https://neon.com/faqs/free-plan-limits-and-quotas , https://neon.com/pricing
- [A3] Clerk: https://clerk.com/articles/clerk-pricing-explained ; https://clerk.com/legal/dpa
- [A4] Convex EU: https://ship.convex.dev/changelog/eu-region-hosting-dublin ; https://news.convex.dev/we-finally-got-our-eu-visa ; https://www.convex.dev/pricing

**Безопасность**
- [O1] OWASP Top 10:2025: https://owasp.org/Top10/2025/
- [O2] OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/llm-top-10/
- [O3] OpenAI moderation (по желанию): https://platform.openai.com/docs/guides/moderation ; [3-я сторона] https://www.analyticsvidhya.com/blog/2026/05/openai-omni-moderation/
- [G1] GitHub: push protection бесплатно для публичных репозиториев: https://github.blog/news-insights/product-news/push-protection-is-generally-available-and-free-for-all-public-repositories/ ; Dependabot: https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts
- [U1] Upstash (если понадобится): https://upstash.com/pricing/redis

**kie.ai**
- [K1] Предыдущий отчёт `docs/research/kie-models.md` (разделы 3.1–3.10, 4.6, 5, 6) и его источники, в том числе https://docs.kie.ai/common-api/webhook-verification , https://docs.kie.ai/

**Право**
- [L1] Ст. 8 DSGVO: https://gdpr-text.com/de/read/article-8 ; https://lxgesetze.de/dsgvo/8 ; https://www.dr-datenschutz.de/anforderungen-an-die-einwilligung-von-kindern-nach-der-dsgvo/
- [L2] §5 DDG: https://www.gesetze-im-internet.de/ddg/__5.html ; IHK: https://www.ihk-muenchen.de/ratgeber/recht/internetrecht/impressum/ , https://www.ihk.de/chemnitz/recht-und-steuern/rechtsinformationen/internetrecht/pflichtangaben-im-internet-die-impressumspflicht-4401580
- [L3] Текст GDPR (ст. 13, 28, 30, 32, 33, 35, 44): https://gdpr-text.com/ru/
- [L4] Молдова, закон 195/2024: https://moldpres.md/eng/society/new-rules-on-personal-data-protection-enter-into-force-in-moldova-as-of-august-23 ; https://logos-pres.md/en/news/new-personal-data-protection-rules-have-taken-effect/ ; https://www.dlapiperdataprotection.com/?c=MD&t=law ; https://datepersonale.md/en/
- [L5] Украина: https://www.gtai.de/de/trade/ukraine/recht/ukraine-datenschutz-und-ki-1981450 ; https://ceelegalmatters.com/ukraine/18482-new-draft-law-of-ukraine-on-personal-data-protection ; https://www.coe.int/en/web/kyiv/-/on-ukraine-s-path-to-eu-membership-webinar-on-personal-data-protection-for-the-ministry-of-justice-of-ukraine ; https://www.radiosvoboda.org/a/zahyst-personalnyh-danyh-dytyny/31603271.html
- [L6] AI Act, ст. 50 и Digital Omnibus: https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force ; https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
- [L7] Telegram 18+ в ЕС: https://opentermsarchive.org/en/memos/telegram-expands-its-age-eligibility-requirement-to-australian-users/ ; https://telegram.org/tos
- [L8] §18 MStV: https://dejure.org/gesetze/MStV/18.html
