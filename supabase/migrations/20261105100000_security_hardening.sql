-- ============================================================================
-- Аудит безопасности (5 ноября 2026).
--
-- 1. Веб-чат и Telegram ботов: лимиты гостей (30 сообщений в час с IP или чата, 200 в сутки
--    на бота) проверялись отдельным запросом до записи сообщения. Параллельные запросы видели
--    один и тот же счётчик и проходили все: каждый вызывал модель за звёзды владельца и кредиты kie.
--    Теперь проверка и запись — одна функция insert_bot_message под advisory-блокировкой бота
--    и отправителя.
--    Плюс bot_messages.dedupe_key — ключ входящего сообщения (bot:<бот>:<id сообщения>,
--    tg:<бот>:<update_id>): повтор того же сообщения (двойной клик, параллельные запросы)
--    больше не вызывает модель второй раз.
--
-- 2. Вход: Supabase Auth видит IP сервера Vercel, а не ученика, поэтому его лимит на перебор
--    паролей общий на всех. rate_limit_hit / rate_limit_reset — свои счётчики попыток входа
--    (по HMAC логина и IP; сами логины и IP не храним) в закрытой схеме private.
--
-- 3. Ученик без группы ничего не тратит (lock_for_spend → forbidden). Такой ученик появляется,
--    только если в Supabase Auth не выключили самостоятельную регистрацию (по умолчанию она
--    включена): тогда любой мог бы завести сколько угодно аккаунтов, взять бонусы за тесты
--    (ответы лежат в публичном репозитории) и тратить кредиты kie. Учеников платформы всегда
--    создаёт учитель — с группой.
--
-- Всё вызывает только сервер (service_role). Миграция идемпотентна: её можно применить повторно.
-- Тесты: supabase/tests/004_security_hardening.test.sql.
-- ============================================================================

-- ===== 1. Сообщения ботов: ключ повтора и атомарные лимиты =====================

alter table public.bot_messages
  add column if not exists dedupe_key text check (char_length(dedupe_key) between 8 and 120);

create unique index if not exists bot_messages_dedupe_once
  on public.bot_messages (bot_id, dedupe_key) where dedupe_key is not null;

-- Записать сообщение. Лимиты — только если переданы (сообщение гостя):
--   p_sender_per_hour — сообщений гостей с этого ip_hash за час (на все боты);
--   p_bot_per_day     — сообщений гостей бота за сутки (без проверки владельцем: owner:…).
-- Результат outcome: accepted | duplicate | sender_hour | bot_day; message_id — у accepted.
create or replace function public.insert_bot_message(
  p_bot                uuid,
  p_channel            text,
  p_conversation_id    text,
  p_role               text,
  p_content            text,
  p_ip_hash            text    default null,
  p_telegram_update_id bigint  default null,
  p_stars              integer default 0,
  p_dedupe_key         text    default null,
  p_sender_per_hour    integer default null,
  p_bot_per_day        integer default null
) returns table (message_id bigint, outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  -- Блокировки до конца транзакции, всегда в одном порядке: бот, потом отправитель
  if p_bot_per_day is not null or p_dedupe_key is not null or p_telegram_update_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('bot_messages:bot:' || p_bot::text, 0));
  end if;
  if p_sender_per_hour is not null and p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('bot_messages:sender:' || p_ip_hash, 0));
  end if;

  -- Повтор того же входящего сообщения: лимит не тратим, модель не зовём
  if p_dedupe_key is not null and exists (
       select 1 from public.bot_messages m where m.bot_id = p_bot and m.dedupe_key = p_dedupe_key) then
    return query select null::bigint, 'duplicate'::text;
    return;
  end if;
  if p_telegram_update_id is not null and exists (
       select 1 from public.bot_messages m
        where m.bot_id = p_bot and m.telegram_update_id = p_telegram_update_id) then
    return query select null::bigint, 'duplicate'::text;
    return;
  end if;

  if p_sender_per_hour is not null and p_ip_hash is not null and (
       select count(*) from public.bot_messages m
        where m.ip_hash = p_ip_hash and m.role = 'user' and m.created_at >= now() - interval '1 hour'
     ) >= p_sender_per_hour then
    return query select null::bigint, 'sender_hour'::text;
    return;
  end if;

  if p_bot_per_day is not null and (
       select count(*) from public.bot_messages m
        where m.bot_id = p_bot and m.role = 'user' and m.conversation_id not like 'owner:%'
          and m.created_at >= now() - interval '1 day'
     ) >= p_bot_per_day then
    return query select null::bigint, 'bot_day'::text;
    return;
  end if;

  insert into public.bot_messages (bot_id, channel, conversation_id, role, content, ip_hash,
                                   telegram_update_id, stars, dedupe_key)
  values (p_bot, p_channel, p_conversation_id, p_role, left(p_content, 4000), p_ip_hash,
          p_telegram_update_id, coalesce(p_stars, 0), p_dedupe_key)
  returning id into v_id;
  return query select v_id, 'accepted'::text;
exception when unique_violation then
  return query select null::bigint, 'duplicate'::text;
end $$;

revoke all on function public.insert_bot_message(uuid, text, text, text, text, text, bigint, integer, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.insert_bot_message(uuid, text, text, text, text, text, bigint, integer, text, integer, integer)
  to service_role;

-- ===== 2. Счётчики попыток (вход) ============================================

create table if not exists private.rate_limit_hits (
  id     bigint generated always as identity primary key,
  key    text not null check (char_length(key) between 8 and 200),
  hit_at timestamptz not null default now()
);
create index if not exists rate_limit_hits_key_idx on private.rate_limit_hits (key, hit_at desc);
create index if not exists rate_limit_hits_at_idx on private.rate_limit_hits (hit_at);

alter table private.rate_limit_hits enable row level security;
revoke all on table private.rate_limit_hits from public, anon, authenticated, service_role;

-- Засчитать попытку по ключу. false — за последние p_window_seconds уже p_limit попыток
-- (попытка не засчитывается). Ключ — HMAC от назначения и значения, его считает сервер.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 8 and 200
     or p_limit is null or p_limit not between 1 and 100000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'bad_rate_limit' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_key, 0));

  delete from private.rate_limit_hits h
   where h.key = p_key and h.hit_at < now() - make_interval(secs => p_window_seconds);
  -- изредка подчищаем ключи, по которым давно не было попыток
  if random() < 0.02 then
    delete from private.rate_limit_hits h where h.hit_at < now() - interval '1 day';
  end if;

  select count(*) into v_count from private.rate_limit_hits h where h.key = p_key;
  if v_count >= p_limit then
    return false;
  end if;
  insert into private.rate_limit_hits (key) values (p_key);
  return true;
end $$;

-- Сбросить счётчик ключа (например, после успешного входа).
create or replace function public.rate_limit_reset(p_key text)
returns void
language sql security definer set search_path = '' as $$
  delete from private.rate_limit_hits h where h.key = p_key
$$;

revoke all on function public.rate_limit_hit(text, integer, integer), public.rate_limit_reset(text)
  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer), public.rate_limit_reset(text)
  to service_role;

-- ===== 3. Ученик без группы ничего не тратит ==================================
-- Тело как в 20261101200000_init.sql, добавлена одна проверка (role = student и group_id is null).

create or replace function private.lock_for_spend(p_user uuid, p_amount integer, p_count_cap boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_disabled  boolean;
  v_role      public.app_role;
  v_group_id  uuid;
  v_paused    boolean;
  v_cap       integer;
  v_spent     bigint;
  v_global    integer;
  v_balance   integer;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  select p.disabled, p.role, p.group_id into v_disabled, v_role, v_group_id from public.profiles p where p.id = p_user;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  if v_disabled then raise exception 'user_disabled' using errcode = 'P0001'; end if;
  if v_role = 'student' and v_group_id is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

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

revoke all on function private.lock_for_spend(uuid, integer, boolean) from public, anon, authenticated, service_role;
