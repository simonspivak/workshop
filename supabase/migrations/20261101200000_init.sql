-- ============================================================================
-- Платформа курса «ИИ-старт»: первая миграция (фаза A).
--
-- Таблицы на весь MVP, чтобы следующим фазам не пришлось рискованно менять схему:
--   profiles, groups, wallets, star_ledger, price_list, settings, jobs,
--   quiz_attempts, lesson_progress, bots, bot_messages, bot_leads, audit_log.
--
-- Принципы:
--   * RLS включён на всех таблицах. Клиентские роли (anon, authenticated) получают
--     только SELECT и только там, где это нужно. Писать напрямую клиенты не могут.
--   * Деньги (звёзды) меняют только функции security definer. Их может вызвать
--     только service_role (сервер с секретным ключом). У service_role нет прав
--     менять wallets и star_ledger напрямую.
--   * Журнал звёзд только дописывается.
--   * Ни на какие автоматические гранты Supabase не рассчитываем: всё выдаём явно.
--
-- Новые миграции: после create table обязательно enable row level security
-- и явные grant/revoke (default privileges ниже отбирают права у клиентов).
-- Тесты: supabase/tests/*.test.sql, запуск — см. docs/platform/setup.md.
-- ============================================================================

-- ===== 0. Гигиена прав =========================================================

create schema if not exists private;          -- НЕ добавлять в Exposed schemas
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Будущие объекты, созданные этой ролью, не открываются клиентам сами
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from anon, authenticated;

-- ===== 1. Типы ================================================================

create type public.app_role as enum ('admin', 'teacher', 'student');
create type public.age_band as enum ('u16', '16_17', 'adult');      -- дату рождения не храним
create type public.job_status as enum ('queued', 'submitted', 'storing', 'done', 'failed');

-- ===== 2. Профили и группы =====================================================

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  role                public.app_role not null default 'student',
  -- логин ученика: <код группы>-<ник>, например md1-lisa. У учителей может быть пустым
  login               text unique check (login ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  nickname            text not null check (char_length(nickname) between 1 and 40),
  group_id            uuid,
  age_band            public.age_band not null default 'u16',      -- по умолчанию самый строгий
  parental_consent_at timestamptz,                                  -- учитель отметил согласие
  disabled            boolean not null default false,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.groups (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[a-z0-9]{2,12}$'),   -- префикс логинов
  title               text not null check (char_length(title) between 1 and 80),
  kind                text not null default 'teens'
                        check (kind in ('teens', 'adults', 'corporate', 'individual', 'demo')),
  teacher_id          uuid not null references public.profiles (id) on delete restrict,
  paused              boolean not null default false,                 -- стоп-кран учителя
  daily_cap           integer not null default 5000 check (daily_cap between 0 and 1000000),
  ends_on             date,                                            -- последний урок
  allow_google_minors boolean not null default false,                  -- модели Google для младших
  share_gallery       boolean not null default false,                  -- ученики видят галерею группы
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index groups_teacher_idx on public.groups (teacher_id);

alter table public.profiles
  add constraint profiles_group_fk foreign key (group_id) references public.groups (id) on delete set null;
create index profiles_group_idx on public.profiles (group_id);

-- ===== 3. Звёзды ==============================================================

create table public.wallets (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),   -- в минус уйти нельзя физически
  updated_at timestamptz not null default now()
);

create table public.price_list (
  action       text not null check (action in
                 ('text', 'image', 'image_edit', 'video', 'motion', 'lipsync', 'voice', 'music',
                  'montage', 'bot_reply')),
  model        text not null check (char_length(model) between 1 and 80),
  -- base — обычная цена; long — длинный текст (> 800 токенов) или длинное видео (> 5 с)
  tier         text not null default 'base' check (tier in ('base', 'long')),
  stars        integer not null check (stars between 0 and 10000),
  -- кому можно: all — всем; adult — 18+; google — 18+, младшим только с allow_google_minors;
  -- adult_or_16_consent — 18+ или 16–17 с согласием; staff — только учитель и админ
  access       text not null default 'all'
                 check (access in ('all', 'adult', 'google', 'adult_or_16_consent', 'staff')),
  library_only boolean not null default false,   -- входные файлы только из библиотеки курса
  enabled      boolean not null default true,
  position     integer not null default 100,     -- порядок; первая доступная модель — по умолчанию
  label        text check (char_length(label) <= 80),
  updated_at   timestamptz not null default now(),
  primary key (action, model, tier)
);

create table public.settings (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ===== 4. Генерации ===========================================================

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  group_id         uuid references public.groups (id) on delete set null,  -- группа на момент создания
  action           text not null check (action in
                     ('text', 'image', 'image_edit', 'video', 'motion', 'lipsync', 'voice', 'music', 'montage')),
  model            text not null check (char_length(model) between 1 and 80),
  params           jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 32768),
  prompt           text check (char_length(prompt) <= 5000),
  status           public.job_status not null default 'queued',
  stars            integer not null default 0 check (stars >= 0),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 100),
  gateway_task_id  text unique check (char_length(gateway_task_id) <= 128),
  storage_path     text check (char_length(storage_path) <= 300),  -- media/{user_id}/{job_id}.{ext}
  extra_paths      text[] not null default '{}',                   -- второй трек, последний кадр
  mime_type        text check (char_length(mime_type) <= 80),
  result_text      text check (char_length(result_text) <= 20000),
  credits          numeric,                                         -- кредиты kie по ответу шлюза
  error            text check (char_length(error) <= 500),
  hidden           boolean not null default false,                  -- учитель скрыл результат
  hidden_by        uuid references public.profiles (id) on delete set null,
  lesson_id        text check (lesson_id ~ '^[a-z0-9-]{1,40}$'),
  task_ref         text check (char_length(task_ref) <= 80),
  last_polled_at   timestamptz,
  submitted_at     timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);
create index jobs_group_created_idx on public.jobs (group_id, created_at desc);
create index jobs_open_idx on public.jobs (user_id) where status in ('queued', 'submitted', 'storing');

-- Журнал звёзд: только дописывается
create table public.star_ledger (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  delta           integer not null check (delta <> 0 and abs(delta) <= 100000),
  reason          text not null check (reason in
                    ('welcome', 'grant', 'adjust', 'debit', 'refund', 'quiz_bonus', 'bot_reply')),
  balance_after   integer not null check (balance_after >= 0),
  job_id          uuid references public.jobs (id),
  ref             text check (char_length(ref) <= 120),
  idempotency_key text check (char_length(idempotency_key) between 8 and 100),
  note            text check (char_length(note) <= 200),
  actor_id        uuid,
  created_at      timestamptz not null default now()
);
-- не больше одного списания и одного возврата на задачу
create unique index star_ledger_job_once on public.star_ledger (job_id, reason) where job_id is not null;
create unique index star_ledger_idem on public.star_ledger (user_id, idempotency_key)
  where idempotency_key is not null;
create unique index star_ledger_quiz_once on public.star_ledger (user_id, ref) where reason = 'quiz_bonus';
create unique index star_ledger_welcome_once on public.star_ledger (user_id) where reason = 'welcome';
create index star_ledger_user_created_idx on public.star_ledger (user_id, created_at desc);

-- ===== 5. Уроки и тесты =======================================================

create table public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  lesson_id  text not null check (lesson_id ~ '^[a-z0-9-]{1,40}$'),
  answers    jsonb not null check (jsonb_typeof(answers) = 'array' and octet_length(answers::text) <= 8192),
  score      integer not null check (score >= 0),
  max_score  integer not null check (max_score > 0),
  bonus      integer not null default 0 check (bonus >= 0),
  created_at timestamptz not null default now(),
  check (score <= max_score),
  unique (user_id, lesson_id)                       -- одна засчитанная попытка на урок
);

create table public.lesson_progress (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  lesson_id    text not null check (lesson_id ~ '^[a-z0-9-]{1,40}$'),
  step         text not null check (step ~ '^[a-z0-9_.:-]{1,60}$'),   -- 'theory', 'task-2', 'quiz'
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id, step)
);

-- ===== 6. Боты (урок 3) =======================================================

create table public.bots (
  id                           uuid primary key default gen_random_uuid(),
  owner_id                     uuid not null unique references public.profiles (id) on delete cascade,
  slug                         text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name                         text not null check (char_length(name) between 1 and 60),
  soul                         text not null default '' check (char_length(soul) <= 4000),
  knowledge                    text not null default '' check (char_length(knowledge) <= 8000),
  tools                        jsonb not null default '{"leads": false, "image": false, "knowledge": false}'::jsonb
                                 check (jsonb_typeof(tools) = 'object' and octet_length(tools::text) <= 2048),
  avatar_job_id                uuid references public.jobs (id) on delete set null,
  active                       boolean not null default true,
  -- Telegram (только adult). Токен зашифрован AES-256-GCM ключом BOT_TOKEN_KEY, в браузер не уходит
  telegram_bot_id              bigint unique,
  telegram_bot_username        text check (telegram_bot_username ~ '^[A-Za-z0-9_]{5,64}$'),
  telegram_token_ciphertext    text,
  telegram_token_iv            text,
  telegram_token_tag           text,
  telegram_webhook_secret_hash text check (char_length(telegram_webhook_secret_hash) <= 128),
  telegram_owner_chat_id       bigint,                  -- куда слать уведомления о заявках
  telegram_connected_at        timestamptz,
  telegram_disconnected_at     timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check ((telegram_token_ciphertext is null) = (telegram_token_iv is null)
         and (telegram_token_iv is null) = (telegram_token_tag is null))
);

-- Короткая история диалогов (сервер берёт последние 10 сообщений)
create table public.bot_messages (
  id                 bigint generated always as identity primary key,
  bot_id             uuid not null references public.bots (id) on delete cascade,
  channel            text not null check (channel in ('web', 'telegram')),
  conversation_id    text not null check (char_length(conversation_id) between 1 and 100),
  role               text not null check (role in ('user', 'assistant')),
  content            text not null check (char_length(content) <= 4000),
  ip_hash            text check (char_length(ip_hash) <= 128),   -- для лимита 30 сообщений в час с IP
  telegram_update_id bigint,
  stars              integer not null default 0 check (stars >= 0),
  created_at         timestamptz not null default now()
);
create index bot_messages_conv_idx on public.bot_messages (bot_id, conversation_id, created_at desc);
create index bot_messages_bot_day_idx on public.bot_messages (bot_id, created_at desc);
create index bot_messages_ip_idx on public.bot_messages (ip_hash, created_at desc) where ip_hash is not null;
create unique index bot_messages_tg_update_once on public.bot_messages (bot_id, telegram_update_id)
  where telegram_update_id is not null;

create table public.bot_leads (
  id              uuid primary key default gen_random_uuid(),
  bot_id          uuid not null references public.bots (id) on delete cascade,
  channel         text not null check (channel in ('web', 'telegram')),
  conversation_id text check (char_length(conversation_id) <= 100),
  data            jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4096),
  notified_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index bot_leads_bot_idx on public.bot_leads (bot_id, created_at desc);

-- ===== 7. Аудит ===============================================================

create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  action       text not null check (action ~ '^[a-z_.]{2,60}$'),
  target_user  uuid,
  target_group uuid,
  meta         jsonb not null default '{}'::jsonb check (octet_length(meta::text) <= 8192),
  created_at   timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_group_idx on public.audit_log (target_group, created_at desc);

-- ===== 8. Служебные триггеры ==================================================

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'groups', 'wallets', 'price_list', 'settings', 'jobs', 'bots'] loop
    execute format(
      'create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

-- Журнал звёзд нельзя менять. Удалять можно только каскадом при удалении пользователя
-- (тогда триггер вызывается из ссылочного триггера, глубина > 1).
create or replace function private.ledger_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'star_ledger is append-only' using errcode = 'P0001';
end $$;

create trigger ledger_append_only before update or delete on public.star_ledger
  for each row execute function private.ledger_append_only();
create trigger ledger_no_truncate before truncate on public.star_ledger
  for each statement execute function private.ledger_append_only();

-- ===== 9. Хелперы для RLS =====================================================

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'admin' and not p.disabled
  )
$$;

-- true для админа (в том числе для строк без группы) и для учителя этой группы
create or replace function private.teaches_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_admin())
      or (p_group is not null and exists (
            select 1 from public.groups g
              join public.profiles t on t.id = g.teacher_id
             where g.id = p_group and g.teacher_id = (select auth.uid())
               and t.role in ('teacher', 'admin') and not t.disabled))
$$;

create or replace function private.teaches_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.teaches_group((select p.group_id from public.profiles p where p.id = p_user))
$$;

create or replace function private.my_group_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.group_id from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function private.owns_or_teaches_bot(p_bot uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bots b
     where b.id = p_bot
       and (b.owner_id = (select auth.uid()) or private.teaches_user(b.owner_id))
  )
$$;

revoke all on function private.is_admin(), private.teaches_group(uuid), private.teaches_user(uuid),
  private.my_group_id(), private.owns_or_teaches_bot(uuid) from public, anon;
grant execute on function private.is_admin(), private.teaches_group(uuid), private.teaches_user(uuid),
  private.my_group_id(), private.owns_or_teaches_bot(uuid) to authenticated, service_role;

-- ===== 10. RLS и гранты =======================================================

do $$
declare t text;
begin
  foreach t in array array['profiles', 'groups', 'wallets', 'price_list', 'settings', 'jobs', 'star_ledger',
                           'quiz_attempts', 'lesson_progress', 'bots', 'bot_messages', 'bot_leads', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
revoke all on all sequences in schema public from public, anon, authenticated;

-- Клиентам (вошедшим пользователям) — только чтение и только своё / своей группы
grant select on public.profiles, public.groups, public.wallets, public.star_ledger, public.price_list,
  public.jobs, public.quiz_attempts, public.lesson_progress, public.bot_messages, public.bot_leads,
  public.audit_log to authenticated;
-- у ботов клиент не видит даже шифротекст токена и хеш секрета вебхука
grant select (id, owner_id, slug, name, soul, knowledge, tools, avatar_job_id, active,
  telegram_bot_username, telegram_connected_at, telegram_disconnected_at, created_at, updated_at)
  on public.bots to authenticated;
-- settings: грантов клиентам нет совсем

-- Сервер (secret key = service_role, BYPASSRLS). Звёзды — только через функции ниже
grant select on public.wallets, public.star_ledger to service_role;
grant select, update on public.profiles to service_role;
grant select, insert, update, delete on public.groups, public.price_list, public.settings, public.bots,
  public.bot_leads, public.lesson_progress to service_role;
grant select, update, delete on public.jobs to service_role;
grant select, delete on public.quiz_attempts to service_role;
grant select, insert, delete on public.bot_messages to service_role;
grant select, insert on public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.teaches_group(group_id));

create policy groups_read on public.groups for select to authenticated
  using (teacher_id = (select auth.uid()) or (select private.is_admin()) or id = (select private.my_group_id()));

create policy wallets_read on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_user(user_id));

create policy ledger_read on public.star_ledger for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_user(user_id));

create policy prices_read on public.price_list for select to authenticated
  using (enabled);

create policy jobs_read on public.jobs for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.teaches_group(group_id)
    -- общая галерея группы, если учитель её включил: только готовые и не скрытые
    or (status = 'done' and not hidden and group_id = (select private.my_group_id())
        and exists (select 1 from public.groups g where g.id = group_id and g.share_gallery))
  );

create policy quiz_attempts_read on public.quiz_attempts for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_user(user_id));

create policy lesson_progress_read on public.lesson_progress for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_user(user_id));

create policy bots_read on public.bots for select to authenticated
  using (owner_id = (select auth.uid()) or private.teaches_user(owner_id));

create policy bot_messages_read on public.bot_messages for select to authenticated
  using (private.owns_or_teaches_bot(bot_id));

create policy bot_leads_read on public.bot_leads for select to authenticated
  using (private.owns_or_teaches_bot(bot_id));

create policy audit_log_read on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- ===== 11. Профиль при создании пользователя ==================================
-- Источник данных — raw_app_meta_data (его задаёт только сервер через admin API).
-- user_metadata пользователь может менять сам, поэтому роль и группу оттуда НЕ берём.
-- Роль всегда student; учителя и админа повышают вручную (docs/platform/setup.md).

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta    jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_login   text := nullif(lower(btrim(v_meta ->> 'login')), '');
  v_group   uuid := nullif(v_meta ->> 'group_id', '')::uuid;
  v_creator uuid := nullif(v_meta ->> 'created_by', '')::uuid;
  v_age     public.age_band := coalesce(nullif(v_meta ->> 'age_band', '')::public.age_band, 'u16');
  v_nick    text := left(coalesce(
                nullif(btrim(v_meta ->> 'nickname'), ''),
                nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                'user'), 40);
  v_welcome integer;
begin
  insert into public.profiles (id, login, nickname, group_id, age_band, created_by)
  values (new.id, v_login, v_nick, v_group, v_age, v_creator);

  insert into public.wallets (user_id, balance) values (new.id, 0);

  -- Новому ученику группы — стартовые звёзды (1000 по умолчанию, settings.welcome_stars)
  if v_group is not null then
    v_welcome := coalesce((select (s.value #>> '{}')::integer from public.settings s
                            where s.key = 'welcome_stars'), 1000);
    if v_welcome > 0 then
      update public.wallets set balance = v_welcome where user_id = new.id;
      insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note)
      values (new.id, v_welcome, 'welcome', v_welcome, v_creator, 'Стартовые звёзды');
    end if;
  end if;
  return new;
end $$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ===== 12. Функции звёзд и задач (вызывает только service_role) ================
-- Ошибки — исключения с кодом в тексте (errcode P0001): generation_disabled, user_not_found,
-- user_disabled, group_paused, daily_cap, insufficient_stars, too_many_jobs, unknown_model,
-- bad_amount, bad_reason, forbidden, job_not_found. Сервер переводит их в коды для интерфейса.

create or replace function private.generation_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.settings s
                    where s.key = 'generation_enabled'), true)
$$;

-- Блокирует группу и кошелёк (всегда в этом порядке), проверяет пользователя, паузу и
-- дневные лимиты. Возвращает текущий баланс. Вызывается только из функций ниже.
create or replace function private.lock_for_spend(p_user uuid, p_amount integer, p_count_cap boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_disabled  boolean;
  v_group_id  uuid;
  v_paused    boolean;
  v_cap       integer;
  v_spent     bigint;
  v_global    integer;
  v_balance   integer;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  select p.disabled, p.group_id into v_disabled, v_group_id from public.profiles p where p.id = p_user;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  if v_disabled then raise exception 'user_disabled' using errcode = 'P0001'; end if;

  if p_amount > 0 and v_group_id is not null then
    select g.paused, g.daily_cap into v_paused, v_cap from public.groups g where g.id = v_group_id for update;
    if v_paused then raise exception 'group_paused' using errcode = 'P0001'; end if;
    if p_count_cap then
      select coalesce(sum(-l.delta), 0) into v_spent
        from public.star_ledger l join public.profiles p on p.id = l.user_id
       where p.group_id = v_group_id and l.reason in ('debit', 'refund') and l.created_at >= v_day_start;
      if v_spent + p_amount > v_cap then raise exception 'daily_cap' using errcode = 'P0001'; end if;
    end if;
  end if;

  if p_amount > 0 and p_count_cap then
    v_global := (select (s.value #>> '{}')::integer from public.settings s where s.key = 'global_daily_cap');
    if v_global is not null then
      select coalesce(sum(-l.delta), 0) into v_spent from public.star_ledger l
       where l.reason in ('debit', 'refund') and l.created_at >= v_day_start;
      if v_spent + p_amount > v_global then raise exception 'daily_cap' using errcode = 'P0001'; end if;
    end if;
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id = p_user for update;
  if not found then
    insert into public.wallets (user_id, balance) values (p_user, 0) returning balance into v_balance;
  end if;
  return v_balance;
end $$;

-- Создать задачу и списать звёзды: всё или ничего. Повтор с тем же ключом вернёт ту же задачу
-- без второго списания. p_stars = 0 — бесплатно (учитель, админ, монтаж), но запись в журнале задач есть.
create or replace function public.create_job(
  p_user            uuid,
  p_action          text,
  p_model           text,
  p_stars           integer,
  p_idempotency_key text,
  p_params          jsonb default '{}'::jsonb,
  p_prompt          text default null,
  p_lesson_id       text default null,
  p_task_ref        text default null
) returns table (job_id uuid, balance integer, reused boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_job        uuid;
  v_balance    integer;
  v_group      uuid;
  v_role       public.app_role;
  v_min_price  integer;
  v_staff_only boolean;
begin
  if p_stars is null or p_stars < 0 or p_stars > 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;

  select j.id into v_job from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idempotency_key;
  if found then
    return query select v_job, (select w.balance from public.wallets w where w.user_id = p_user), true;
    return;
  end if;

  if p_action <> 'montage' and not private.generation_enabled() then
    raise exception 'generation_disabled' using errcode = 'P0001';
  end if;

  v_balance := private.lock_for_spend(p_user, p_stars, true);

  -- повторная проверка под блокировкой кошелька: два одновременных клика
  select j.id into v_job from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idempotency_key;
  if found then
    return query select v_job, v_balance, true;
    return;
  end if;

  if p_action <> 'montage' and (select count(*) from public.jobs j
       where j.user_id = p_user and j.status in ('queued', 'submitted', 'storing')) >= 5 then
    raise exception 'too_many_jobs' using errcode = 'P0001';
  end if;

  -- Вторая линия защиты от ошибок сервера: модель из прайса, ученику — не дешевле прайса
  -- и не модели «только для учителя».
  select p.role, p.group_id into v_role, v_group from public.profiles p where p.id = p_user;
  select min(pl.stars), bool_and(pl.access = 'staff') into v_min_price, v_staff_only
    from public.price_list pl where pl.action = p_action and pl.model = p_model and pl.enabled;
  if v_min_price is null then raise exception 'unknown_model' using errcode = 'P0001'; end if;
  if v_role = 'student' and (v_staff_only or p_stars < v_min_price) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_balance < p_stars then
    raise exception 'insufficient_stars' using errcode = 'P0001';
  end if;

  insert into public.jobs (user_id, group_id, action, model, params, prompt, stars, idempotency_key,
                           lesson_id, task_ref)
  values (p_user, v_group, p_action, p_model, coalesce(p_params, '{}'::jsonb), p_prompt, p_stars,
          p_idempotency_key, p_lesson_id, p_task_ref)
  returning id into v_job;

  if p_stars > 0 then
    update public.wallets w set balance = w.balance - p_stars, updated_at = now()
     where w.user_id = p_user returning w.balance into v_balance;
    insert into public.star_ledger (user_id, delta, reason, balance_after, job_id, actor_id)
    values (p_user, -p_stars, 'debit', v_balance, v_job, p_user);
  end if;

  return query select v_job, v_balance, false;
end $$;

-- Шлюз принял задачу
create or replace function public.mark_job_submitted(p_job uuid, p_task_id text) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.jobs set status = 'submitted', gateway_task_id = p_task_id,
           submitted_at = now(), last_polled_at = now()
     where id = p_job and status = 'queued'
    returning 1)
  select exists (select 1 from u)
$$;

-- Можно ли сейчас спросить шлюз о статусе (не чаще раза в p_min_interval секунд на задачу)
create or replace function public.claim_job_poll(p_job uuid, p_min_interval integer default 5) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.jobs set last_polled_at = now()
     where id = p_job and status = 'submitted'
       and (last_polled_at is null
            or last_polled_at <= now() - make_interval(secs => greatest(p_min_interval, 1)))
    returning 1)
  select exists (select 1 from u)
$$;

-- Ровно один обработчик копирует результат в Storage. Зависшее копирование (> 3 мин) можно перехватить.
create or replace function public.begin_job_storing(p_job uuid) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.jobs set status = 'storing'
     where id = p_job
       and (status = 'submitted' or (status = 'storing' and updated_at < now() - interval '3 minutes'))
    returning 1)
  select exists (select 1 from u)
$$;

create or replace function public.complete_job(
  p_job          uuid,
  p_storage_path text default null,
  p_extra_paths  text[] default '{}',
  p_mime_type    text default null,
  p_result_text  text default null,
  p_credits      numeric default null
) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.jobs set status = 'done', storage_path = p_storage_path,
           extra_paths = coalesce(p_extra_paths, '{}'), mime_type = p_mime_type,
           result_text = p_result_text, credits = p_credits, error = null, completed_at = now()
     where id = p_job and status in ('queued', 'submitted', 'storing')
    returning 1)
  select exists (select 1 from u)
$$;

-- Закрыть задачу с ошибкой и вернуть звёзды. Повторный вызов ничего не делает.
-- Возвращается ровно то, что было списано по журналу (а не jobs.stars).
create or replace function public.refund_job(p_job uuid, p_error text)
returns table (refunded integer, balance integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user    uuid;
  v_status  public.job_status;
  v_debit   integer;
  v_balance integer;
begin
  select j.user_id, j.status into v_user, v_status from public.jobs j where j.id = p_job for update;
  if not found then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  if v_status in ('done', 'failed') then
    return query select 0, (select w.balance from public.wallets w where w.user_id = v_user);
    return;
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id = v_user for update;
  update public.jobs set status = 'failed', error = left(coalesce(p_error, 'failed'), 500), completed_at = now()
   where id = p_job;

  select -l.delta into v_debit from public.star_ledger l where l.job_id = p_job and l.reason = 'debit';
  if coalesce(v_debit, 0) > 0
     and not exists (select 1 from public.star_ledger l where l.job_id = p_job and l.reason = 'refund') then
    update public.wallets w set balance = w.balance + v_debit, updated_at = now()
     where w.user_id = v_user returning w.balance into v_balance;
    insert into public.star_ledger (user_id, delta, reason, balance_after, job_id, note)
    values (v_user, v_debit, 'refund', v_balance, p_job, left(coalesce(p_error, ''), 200));
    return query select v_debit, v_balance;
    return;
  end if;
  return query select 0, v_balance;
end $$;

-- Начислить (p_amount > 0) или снять (< 0) звёзды. Учитель — только ученикам своей группы.
create or replace function public.grant_stars(
  p_actor           uuid,
  p_user            uuid,
  p_amount          integer,
  p_note            text default null,
  p_idempotency_key text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role;
  v_group   uuid;
  v_ok      boolean;
  v_balance integer;
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_actor and not p.disabled;
  select p.group_id into v_group from public.profiles p where p.id = p_user;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  v_ok := v_role = 'admin'
          or (v_role = 'teacher' and exists (
                select 1 from public.groups g where g.id = v_group and g.teacher_id = p_actor));
  if not coalesce(v_ok, false) then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select w.balance into v_balance from public.wallets w where w.user_id = p_user for update;
  if not found then
    insert into public.wallets (user_id, balance) values (p_user, 0) returning balance into v_balance;
  end if;

  if p_idempotency_key is not null and exists (
       select 1 from public.star_ledger l where l.user_id = p_user and l.idempotency_key = p_idempotency_key) then
    return v_balance;
  end if;

  if v_balance + p_amount < 0 then raise exception 'insufficient_stars' using errcode = 'P0001'; end if;

  update public.wallets w set balance = w.balance + p_amount, updated_at = now()
   where w.user_id = p_user returning w.balance into v_balance;
  insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note, idempotency_key)
  values (p_user, p_amount, case when p_amount > 0 then 'grant' else 'adjust' end, v_balance, p_actor,
          left(p_note, 200), p_idempotency_key);
  insert into public.audit_log (actor_id, action, target_user, target_group, meta)
  values (p_actor, 'stars.grant', p_user, v_group,
          jsonb_build_object('amount', p_amount, 'note', left(p_note, 200), 'balance', v_balance));
  return v_balance;
end $$;

-- Списать звёзды без задачи генерации: ответ бота (1★ со звёзд владельца).
-- Идемпотентно по p_idempotency_key (например, id сообщения или update_id Telegram).
create or replace function public.spend_stars(
  p_user            uuid,
  p_amount          integer,
  p_reason          text,
  p_idempotency_key text,
  p_ref             text default null
) returns table (balance integer, charged boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_balance integer;
begin
  if p_reason is distinct from 'bot_reply' then raise exception 'bad_reason' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then raise exception 'bad_amount' using errcode = 'P0001'; end if;
  if not private.generation_enabled() then raise exception 'generation_disabled' using errcode = 'P0001'; end if;

  v_balance := private.lock_for_spend(p_user, p_amount, false);

  if exists (select 1 from public.star_ledger l where l.user_id = p_user and l.idempotency_key = p_idempotency_key) then
    return query select v_balance, false;
    return;
  end if;
  if v_balance < p_amount then raise exception 'insufficient_stars' using errcode = 'P0001'; end if;

  update public.wallets w set balance = w.balance - p_amount, updated_at = now()
   where w.user_id = p_user returning w.balance into v_balance;
  insert into public.star_ledger (user_id, delta, reason, balance_after, ref, idempotency_key, actor_id)
  values (p_user, -p_amount, p_reason, v_balance, left(p_ref, 120), p_idempotency_key, p_user);
  return query select v_balance, true;
end $$;

-- Засчитать попытку теста (одна на урок) и один раз начислить бонус.
-- Оценку и размер бонуса считает сервер (правильные ответы в браузер не уходят).
create or replace function public.record_quiz_attempt(
  p_user      uuid,
  p_lesson_id text,
  p_answers   jsonb,
  p_score     integer,
  p_max_score integer,
  p_bonus     integer default 0
) returns table (attempt_id uuid, score integer, max_score integer, bonus integer, balance integer,
                 already_done boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_attempt uuid;
  v_score   integer;
  v_max     integer;
  v_bonus   integer;
  v_balance integer;
begin
  if p_bonus is null or p_bonus < 0 or p_bonus > 100 then raise exception 'bad_amount' using errcode = 'P0001'; end if;

  select w.balance into v_balance from public.wallets w where w.user_id = p_user for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;

  select a.id, a.score, a.max_score, a.bonus into v_attempt, v_score, v_max, v_bonus
    from public.quiz_attempts a where a.user_id = p_user and a.lesson_id = p_lesson_id;
  if found then
    return query select v_attempt, v_score, v_max, v_bonus, v_balance, true;
    return;
  end if;

  insert into public.quiz_attempts (user_id, lesson_id, answers, score, max_score, bonus)
  values (p_user, p_lesson_id, p_answers, p_score, p_max_score, p_bonus)
  returning id into v_attempt;

  if p_bonus > 0 then
    update public.wallets w set balance = w.balance + p_bonus, updated_at = now()
     where w.user_id = p_user returning w.balance into v_balance;
    insert into public.star_ledger (user_id, delta, reason, balance_after, ref, actor_id)
    values (p_user, p_bonus, 'quiz_bonus', v_balance, p_lesson_id, p_user);
  end if;

  return query select v_attempt, p_score, p_max_score, p_bonus, v_balance, false;
end $$;

-- Закрываем все функции от клиентов: по умолчанию EXECUTE есть у PUBLIC
revoke all on function private.generation_enabled(), private.lock_for_spend(uuid, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.touch_updated_at(), private.ledger_append_only()
  from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_job(uuid, text, text, integer, text, jsonb, text, text, text)',
    'public.mark_job_submitted(uuid, text)',
    'public.claim_job_poll(uuid, integer)',
    'public.begin_job_storing(uuid)',
    'public.complete_job(uuid, text, text[], text, text, numeric)',
    'public.refund_job(uuid, text)',
    'public.grant_stars(uuid, uuid, integer, text, text)',
    'public.spend_stars(uuid, integer, text, text, text)',
    'public.record_quiz_attempt(uuid, text, jsonb, integer, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ===== 13. Настройки и прайс ==================================================

insert into public.settings (key, value) values
  ('generation_enabled', 'true'),   -- глобальный рубильник генераций
  ('welcome_stars', '1000'),        -- стартовые звёзды нового ученика
  ('global_daily_cap', 'null');     -- общий дневной лимит звёзд на всех; null — без лимита

-- Прайс из docs/platform/spec.md §2. Учитель и админ генерируют бесплатно (демо-режим),
-- но только моделями из этого списка. Менять цены можно без деплоя.
insert into public.price_list (action, model, tier, stars, access, library_only, position, label) values
  ('text',       'claude-haiku-5-5',             'base',  1, 'all',                 false, 10, 'Claude Haiku 5.5, до 800 токенов'),
  ('text',       'claude-haiku-5-5',             'long',  3, 'all',                 false, 10, 'Claude Haiku 5.5, длинный ответ'),
  ('text',       'gpt-6-luna',                   'base',  0, 'staff',               false, 80, 'GPT-6 Luna'),
  ('text',       'claude-sonnet-5-5',            'base',  0, 'staff',               false, 90, 'Claude Sonnet 5.5'),
  ('image',      'flux-3/klein-text-to-image',   'base',  2, 'all',                 false, 10, 'FLUX 3 Klein'),
  ('image',      'nano-banana-2-1',              'base',  5, 'google',              false, 20, 'Nano Banana 2.1'),
  ('image',      'nano-banana-pro',              'base',  0, 'staff',               false, 90, 'Nano Banana Pro'),
  ('image_edit', 'flux-3/klein-edit-image',      'base',  2, 'all',                 false, 10, 'FLUX 3 Klein Edit'),
  ('image_edit', 'nano-banana-2-1',              'base',  5, 'google',              false, 20, 'Nano Banana 2.1'),
  ('image_edit', 'nano-banana-pro',              'base',  0, 'staff',               false, 90, 'Nano Banana Pro'),
  ('video',      'bytedance/seedance-2-mini',    'base', 25, 'all',                 false, 10, 'Seedance 2.0 Mini, 480p, 5 с'),
  ('video',      'bytedance/seedance-2-mini',    'long', 50, 'all',                 false, 10, 'Seedance 2.0 Mini, 480p, 10 с'),
  ('video',      'bytedance/seedance-2-5',       'base',  0, 'staff',               false, 80, 'Seedance 2.5'),
  ('video',      'kling-4.0/reference-to-video', 'base',  0, 'staff',               false, 85, 'Kling 4.0'),
  ('video',      'wan/3-0-video',                'base',  0, 'staff',               false, 90, 'Wan 3.0'),
  ('video',      'wan/3-0-video-prime',          'base',  0, 'staff',               false, 95, 'Wan 3.0 Prime'),
  ('voice',      'google/gemini-3-8-flash-tts',  'base',  2, 'google',              false, 10, 'Gemini TTS'),
  ('music',      'ai-music-api/generate',        'base', 15, 'all',                 false, 10, 'Suno V6 Mini'),
  ('motion',     'kling-2.6/motion-control',     'base', 70, 'adult_or_16_consent', true,  10, 'Kling 2.6 Motion Control'),
  ('motion',     'wan/2-2-animate-move',         'base',  0, 'staff',               false, 90, 'Wan 2.2 Animate'),
  ('lipsync',    'kling/ai-avatar-standard',     'base', 60, 'adult',               false, 10, 'Kling AI Avatar'),
  ('lipsync',    'infinitalk/from-audio',        'base',  0, 'staff',               false, 90, 'InfiniteTalk'),
  ('montage',    'platform/auto-montage',        'base',  0, 'all',                 false, 10, 'Автомонтаж в браузере'),
  ('bot_reply',  'claude-haiku-5-5',             'base',  1, 'all',                 false, 10, 'Ответ бота');

-- ===== 14. Storage: приватный бакет media =======================================
-- Пути: {user_id}/{job_id}.{ext}. Загружает и подписывает ссылки только сервер.
-- Клиентам — только чтение своей папки (политика ниже). Записи с клиента нет.
-- Если в проекте нет прав на storage из миграции, блоки пропускаются с NOTICE:
-- тогда создать бакет вручную (docs/platform/setup.md).

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', false, 52428800,
            array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4',
                  'audio/wav', 'audio/x-wav', 'audio/wave'])
    on conflict (id) do update set public = false;
  else
    raise notice 'storage.buckets not found: create bucket "media" manually';
  end if;
exception when insufficient_privilege then
  raise notice 'no privilege on storage.buckets: create bucket "media" manually';
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists media_owner_read on storage.objects;
    create policy media_owner_read on storage.objects for select to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
  else
    raise notice 'storage.objects not found: skip media policy';
  end if;
exception when insufficient_privilege then
  raise notice 'no privilege on storage.objects: add media policy manually';
end $$;
