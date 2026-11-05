# Платформа курса: настройка

Инструкция для владельца (Сени): что включить в Supabase, Vercel и n8n, как создать первого админа и как проверить базу локально. Спецификация — [`spec.md`](./spec.md).

Репозиторий публичный. Адреса, ключи и имя хоста n8n — только в настройках Vercel и в менеджере паролей. В git, в доки и в чаты их не кладём.

## Коротко: порядок

1. Supabase: настройки входа, Data API, ключи, интеграция с GitHub (раздел 1).
2. Слить ветку с миграцией в `main` и убедиться, что миграция применилась (1.5).
3. Создать первого админа (1.7).
4. Vercel: переменные окружения и повторный деплой (раздел 2).
5. n8n: опубликовать шлюз и вписать его адрес и секрет в Vercel (раздел 3).
6. Пройти проверку после запуска (раздел 5).

## 1. Supabase

Проект `workshop`, регион ЕС (Frankfurt).

### 1.1. Вход (Authentication)

**Authentication → Sign In / Providers:**

- **Allow new users to sign up** — выключить. Регистрации нет: учеников создаёт учитель из кабинета.
- **Allow anonymous sign-ins** — выключить.
- **Email** — включён. **Confirm email** можно выключить: писем нет, учеников сервер создаёт уже подтверждёнными.

**Authentication → Sign In / Providers → Email** (или **Policies → Passwords**, название раздела может отличаться):

- **Minimum password length** — 10.
- **Password requirements** — «без обязательных символов» или «буквы и цифры». Не требовать заглавные буквы: пароли учеников из маленьких букв, цифр и дефисов (`kiwi-raketa-sova-42`), с таким требованием их создание сломается.

**Authentication → Rate Limits** — оставить как есть. Они защищают вход от перебора.

**Project Settings → JWT Keys** — у нового проекта подписи асимметричные (ECC или RSA). Так и оставить: тогда сессия проверяется без лишнего запроса в Supabase. Если проект старый и стоит Legacy JWT Secret — перейти на новые ключи по подсказке на этой странице.

### 1.2. Data API: ничего не открывается само

**Project Settings → Data API:**

- **Exposed schemas** — только `public` (и `graphql_public`, если она там по умолчанию). Схему `private` не добавлять.
- Если есть переключатель автоматического доступа к новым таблицам и функциям (**Automatically expose new tables / functions** или похожий) — выключить.

Миграция всё равно сама отбирает права у `anon` и `authenticated` и выдаёт только чтение нужных таблиц. На автоматические настройки она не рассчитывает. Но выключенный переключатель страхует будущие миграции.

### 1.3. Ключи

**Project Settings → API Keys:**

- **Publishable key** → переменная `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Он публичный по задумке: попадает в браузер, но без входа ничего не читает.
- **Secret key**: нажать **Create new secret key**, назвать `vercel` → переменная `SUPABASE_SECRET_KEY`. Это полный доступ к базе в обход RLS: только Vercel (тип Sensitive) и менеджер паролей.
- **Project URL** (Project Settings → Data API или кнопка **Connect**) → `NEXT_PUBLIC_SUPABASE_URL`.
- Старые ключи `anon` и `service_role` (вкладка Legacy API Keys) платформа не использует. Когда всё заработает, их можно выключить.

Ротация секретного ключа: создать новый, заменить в Vercel, задеплоить, удалить старый.

### 1.4. Storage

Миграция сама создаёт приватный бакет `media` (лимит файла 50 МБ — это потолок бесплатного тарифа). Проверить: **Storage → media**, значок **Private**.

Если бакета нет (миграции не хватило прав на схему `storage`), создать вручную:

- **Storage → New bucket**, имя `media`, **Public bucket** — выкл.
- **Restrict file size** — 50 MB.
- **Allowed MIME types**: `image/png, image/jpeg, image/webp, video/mp4, audio/mpeg, audio/mp4, audio/wav, audio/x-wav, audio/wave`.

Политика чтения (вошедший ученик видит только свою папку `{user_id}/…`) создаётся той же миграцией. Если её нет в **Storage → Policies**, выполнить в **SQL Editor**:

```sql
create policy media_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

Загружает файлы и выдаёт подписанные ссылки только сервер.

### 1.5. Миграции из GitHub

**Project Settings → Integrations → GitHub:**

- репозиторий подключён;
- **Supabase directory** — `supabase`;
- **Production branch** — `main`, **Deploy to production** — включено.

Миграции из `supabase/migrations/` применяются после слияния в `main`. Откатить применённую миграцию нельзя, поэтому каждая проверяется локально до слияния (раздел 4).

После первого деплоя проверить:

- **Database → Migrations**: есть `20261101200000_init`;
- **Table Editor**: таблицы `profiles`, `groups`, `wallets`, `star_ledger`, `price_list`, `jobs` и другие, у всех значок RLS;
- **Database → Functions**: `create_job`, `refund_job`, `grant_stars` и другие.

Если интеграция не сработала, ту же миграцию можно применить вручную: открыть файл `supabase/migrations/20261101200000_init.sql` и выполнить его целиком в **SQL Editor** один раз.

### 1.6. Настройки в базе

Меняются в **SQL Editor** без деплоя:

```sql
-- выключить все генерации (рубильник) и включить обратно
update public.settings set value = 'false' where key = 'generation_enabled';
update public.settings set value = 'true'  where key = 'generation_enabled';

-- стартовые звёзды нового ученика (по умолчанию 1000)
update public.settings set value = '1000' where key = 'welcome_stars';

-- общий дневной лимит звёзд на всю платформу (null — без лимита)
update public.settings set value = '20000' where key = 'global_daily_cap';

-- поменять цену или выключить модель
update public.price_list set stars = 3 where action = 'image' and model = 'flux-3/klein-text-to-image';
update public.price_list set enabled = false where action = 'lipsync' and model = 'kling/ai-avatar-standard';
```

Сервер кеширует прайс до минуты.

### 1.7. Первый админ и учителя

1. **Authentication → Users → Add user → Create new user**: ваш e-mail, пароль от 10 символов, галочка **Auto Confirm User**.
2. **SQL Editor** — повысить до админа (подставьте свой e-mail):

   ```sql
   update public.profiles
      set role = 'admin', age_band = 'adult'
    where id = (select id from auth.users where email = 'ваш-email@example.com');
   ```

3. Проверить: должна вернуться одна строка с `role = admin`.

   ```sql
   select p.id, p.role, p.nickname from public.profiles p where p.role = 'admin';
   ```

Учитель создаётся так же: добавить пользователя в Authentication, затем `set role = 'teacher', age_band = 'adult'`. Учитель видит только свои группы. Админ видит все группы и журнал аудита.

Роль хранится только в `public.profiles.role`. Поля `user_metadata` пользователь может менять сам, поэтому платформа их для прав не читает.

## 2. Vercel: переменные окружения

**Vercel → проект → Settings → Environment Variables.** Секретные — с типом **Sensitive**.

| Переменная | Тип | Production | Preview | Откуда |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | обычная | да | да | Supabase → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | обычная | да | да | Supabase → API Keys → Publishable key |
| `SUPABASE_SECRET_KEY` | **Sensitive** | да | да | Supabase → API Keys → Secret key |
| `KIE_GATEWAY_URL` | **Sensitive** | да | **нет** | n8n → шлюз → Production URL вебхука (раздел 3) |
| `KIE_GATEWAY_KEY` | **Sensitive** | да | **нет** | n8n → узел `Build KIE Request` → `SECRET` |
| `BOT_TOKEN_KEY` | **Sensitive** | да | да (своё значение) | `openssl rand -base64 32` |
| `STUDENT_EMAIL_DOMAIN` | обычная | да | да | свой поддомен без почты, например `u.ваш-домен` |
| `APP_URL` | обычная | да | по желанию | адрес сайта на Vercel, `https://…` без слеша в конце |

Важно:

- **Preview без шлюза.** Каждая ветка и каждый PR получают preview-деплой. Если там есть `KIE_GATEWAY_*`, любой код из ветки может тратить кредиты kie. Без `KIE_GATEWAY_URL` платформа работает в **mock-режиме**: модели не вызываются, вместо ответов — заглушки (подробнее — в разделе 3).
- **Preview и Supabase.** Если в Preview подставить ключи боевого проекта, preview-деплои работают с боевой базой. Безопаснее отдельный бесплатный проект Supabase для Preview (тогда и его ключи). Решение за вами.
- **`STUDENT_EMAIL_DOMAIN` выбирается один раз.** Логин `md1-lisa` превращается в технический адрес `md1-lisa@<домен>`. Если домен поменять, созданные ученики не смогут войти. Домен должен быть вашим (или `students.example.com`, он зарезервирован и почты там нет). Если переменную не задать, используется `students.example.com`.
- Публичные переменные (`NEXT_PUBLIC_*`) нужны и при сборке: по адресу Supabase собирается заголовок безопасности CSP. После их изменения — **Redeploy**.
- Сборка проходит и без переменных: тогда кабинет показывает «Платформа ещё не подключена», а публичный сайт работает как раньше.

## 3. Шлюз в n8n

Контракт шлюза — [`../kie-gateway.md`](../kie-gateway.md).

1. Открыть в n8n workflow **«ИИ-старт: шлюз KIE для курса»** и опубликовать его (**Publish** / **Active**). Пока workflow не опубликован, production-адрес не отвечает.
2. Открыть первый узел **Webhook** → вкладка **Production URL** → скопировать адрес. Это `KIE_GATEWAY_URL`.
3. Открыть узел **Build KIE Request** → константа `SECRET` в начале кода. Это `KIE_GATEWAY_KEY`. Если хотите новый секрет: сгенерировать (`openssl rand -base64 32`), вписать в узел, сохранить и опубликовать workflow, затем поменять в Vercel.
4. Вписать обе переменные в Vercel **только для Production** и сделать **Redeploy**.
5. Проверить шлюз из терминала (подставьте значения из менеджера паролей, в историю команд их лучше не сохранять):

   ```bash
   curl -s -X POST "$KIE_GATEWAY_URL" \
     -H "x-iistart-key: $KIE_GATEWAY_KEY" \
     -H "content-type: application/json" \
     -d '{"action":"balance"}'
   ```

   Ответ вида `{"ok":true,"credits":…}` — шлюз работает. Без заголовка шлюз запрос не обрабатывает.

**Mock-режим** включается сам, если `KIE_GATEWAY_URL` не задан (Preview, локальная разработка):

- текст возвращается сразу, с пометкой «тестовый ответ»;
- картинки, видео, озвучка и музыка «готовы» через 2–8 секунд, вместо результата — встроенный файл-заглушка (фиолетовый кадр, секунда видео, короткий тон);
- если в промпте есть `[[mock-fail]]`, генерация завершится ошибкой — так проверяется возврат звёзд.

## 4. Проверка базы локально

Перед слиянием каждой новой миграции в `main`.

**Без Docker** (нужны PostgreSQL 16: `initdb`, `pg_ctl`, `psql`; на Ubuntu — пакет `postgresql-16`):

```bash
scripts/db-test/run.sh
```

Скрипт поднимает временный кластер, накатывает заглушку Supabase (роли `anon`, `authenticated`, `service_role`, схемы `auth` и `storage`, стандартные права Supabase), все миграции и прогоняет `supabase/tests/*.test.sql`. Если расширения pgTAP нет, подключается его минимальная замена. В конце — «Все SQL-тесты прошли» или список упавших проверок. Кластер удаляется после прогона (`KEEP_DB=1` — оставить для отладки).

**С Supabase CLI** (нужен Docker): `supabase start`, затем `supabase test db`.

Что проверяют тесты:

- `001_rls.test.sql` — ученик А не видит ученика Б даже в своей группе; учитель видит только свою группу; админ — всё; аноним — ничего; клиенты не пишут ни в одну таблицу и не вызывают ни одной функции; шифротекст токена бота клиенту недоступен; RLS включён на каждой таблице.
- `002_wallet.test.sql` — 1000 звёзд новому ученику; списание; повтор с тем же ключом не списывает дважды; возврат один раз; баланс не уходит в минус; пауза группы; дневной лимит; рубильник; не больше 5 задач в работе; учитель начисляет только своим; бонус за тест один раз; журнал звёзд нельзя менять; удаление пользователя проходит.
- `004_security_hardening.test.sql` — лимиты сообщений гостей ботов (30 в час с IP, 200 в сутки на бота) проверяются при записи, повтор того же сообщения не записывается; счётчики попыток входа; ученик без группы ничего не тратит; клиенты не вызывают эти функции.

## 5. Проверка после запуска

1. Открыть `/login`, войти админом → откроется `/teach`.
2. Создать группу (код, например `md1`) → добавить 2–3 ника → «Печать карточек».
3. В другом браузере войти учеником по карточке → `/app`: баланс 1000 ★.
4. Учителем начислить ученику звёзды и поставить группу на паузу → ученик видит паузу.
5. Админом проверить журнал: `select action, created_at from public.audit_log order by id desc limit 10;`

## Для разработчиков: где что

- `supabase/migrations/` — схема, RLS, функции звёзд; `supabase/tests/` — SQL-тесты; `scripts/db-test/` — локальный прогон.
- `lib/server/env.ts` — единственное место, где читается `process.env`.
- `lib/server/dal/auth.ts` — `getUser`, `requireUser`, `requireRole`, `authorize` (для Server Actions и Route Handlers).
- `lib/server/wallet.ts`, `lib/server/jobs.ts` — звёзды и состояния задач (только через SQL-функции).
- `lib/server/gateway.ts` — клиент шлюза, mock-режим, безопасное скачивание результатов.
- `lib/server/prices.ts` — прайс и правила доступа (`canUse`); `lib/server/moderation.ts` — стоп-слова и персональные данные.
- `proxy.ts` — обновление сессии и редиректы на `/login`. Это не авторизация: права проверяет каждая страница и каждое действие.
