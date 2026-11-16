-- ============================================================================
-- Лимиты гостей ботов и пауза бота (аудит 8–9 ноября 2026, № 4 / BP-1 и № 9 / BP-2).
--
-- 1. Лимит «30 сообщений в час» считался по хешу IP и на все боты сразу: весь класс за одним
--    Wi-Fi упирался в 30 сообщений на всех. Теперь:
--      • p_sender_per_hour — на посетителя: по conversation_id (web:<сессия гостя> из cookie,
--        tg:<хеш чата>), на все боты. Новой колонки не нужно, conversation_id уже есть;
--      • p_ip_per_hour (новый) — потолок на сеть по ip_hash (только веб), намного выше;
--      • p_bot_per_day — как было, на бота в сутки;
--      • общий потолок гостевых сообщений на всю платформу в сутки — настройка
--        settings.bot_guest_daily_global (по умолчанию 2000; null — без потолка). Новый исход
--        'global_day'. Блокировки для него нет: перебор на несколько сообщений допустим.
--    Блокировки — всегда в одном порядке: бот → посетитель → сеть.
-- 2. bots.paused — пауза, которую ставит и снимает сам владелец. Не путать с bots.active:
--    active = false — «снят с публикации» (гости видят «бот переехал», вебхук Telegram
--    снимается и токен стирается). На паузе бот отвечает гостям коротким текстом, модель
--    не зовёт и звёзды не тратит; Telegram остаётся подключённым.
--
-- Безопасно на боевых данных: новая колонка со значением по умолчанию (без перезаписи
-- таблицы), индексы на небольшой таблице, настройка — только если её ещё нет. Старая версия
-- insert_bot_message (11 аргументов) удаляется, чтобы PostgREST не путал перегрузки (PGRST203);
-- новая принимает те же именованные аргументы, поэтому старый код продолжает работать.
-- Тесты: supabase/tests/004_security_hardening.test.sql.
-- ============================================================================

-- ===== 1. Пауза бота ==========================================================

alter table public.bots add column if not exists paused boolean not null default false;

-- Клиентам — только чтение (как остальные несекретные колонки bots); пишет сервер
grant select (paused) on public.bots to authenticated;

-- ===== 2. Индексы для новых счётчиков ==========================================

-- Сообщения посетителя за час на все боты (bot_messages_conv_idx начинается с bot_id и не подходит)
create index if not exists bot_messages_conv_hour_idx
  on public.bot_messages (conversation_id, created_at desc) where role = 'user';

-- Гостевые сообщения всей платформы за сутки
create index if not exists bot_messages_guest_day_idx
  on public.bot_messages (created_at) where role = 'user';

-- ===== 3. Общий дневной потолок (настройка, меняется в таблице settings) ======

insert into public.settings (key, value) values ('bot_guest_daily_global', '2000'::jsonb)
on conflict (key) do nothing;

-- ===== 4. insert_bot_message с лимитами на посетителя и сеть ===================

drop function if exists public.insert_bot_message(uuid, text, text, text, text, text, bigint, integer, text, integer, integer);

-- Записать сообщение. Лимиты — только если переданы (сообщение гостя):
--   p_sender_per_hour — сообщений этого посетителя (conversation_id) за час, на все боты;
--   p_ip_per_hour     — сообщений гостей с этого ip_hash (сеть) за час, на все боты;
--   p_bot_per_day     — сообщений гостей бота за сутки (без проверки владельцем: owner:…);
--                       вместе с ним проверяется и settings.bot_guest_daily_global.
-- Результат outcome: accepted | duplicate | sender_hour | network_hour | bot_day | global_day;
-- message_id — у accepted.
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
  p_bot_per_day        integer default null,
  p_ip_per_hour        integer default null
) returns table (message_id bigint, outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_id     bigint;
  v_raw    text;
  v_global integer;
begin
  -- Блокировки до конца транзакции, всегда в одном порядке: бот, посетитель, сеть
  if p_bot_per_day is not null or p_dedupe_key is not null or p_telegram_update_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('bot_messages:bot:' || p_bot::text, 0));
  end if;
  if p_sender_per_hour is not null then
    perform pg_advisory_xact_lock(hashtextextended('bot_messages:conv:' || p_conversation_id, 0));
  end if;
  if p_ip_per_hour is not null and p_ip_hash is not null then
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

  -- Посетитель (сессия веб-гостя или чат Telegram), на все боты
  if p_sender_per_hour is not null and (
       select count(*) from public.bot_messages m
        where m.conversation_id = p_conversation_id and m.role = 'user'
          and m.created_at >= now() - interval '1 hour'
     ) >= p_sender_per_hour then
    return query select null::bigint, 'sender_hour'::text;
    return;
  end if;

  -- Сеть (хеш IP; IPv6 — /64), на все боты: защита от перебора cookie
  if p_ip_per_hour is not null and p_ip_hash is not null and (
       select count(*) from public.bot_messages m
        where m.ip_hash = p_ip_hash and m.role = 'user' and m.created_at >= now() - interval '1 hour'
     ) >= p_ip_per_hour then
    return query select null::bigint, 'network_hour'::text;
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

  -- Общий потолок платформы (настройка; не число или null — без потолка)
  if p_bot_per_day is not null then
    v_raw := (select s.value #>> '{}' from public.settings s where s.key = 'bot_guest_daily_global');
    v_global := case when v_raw ~ '^[0-9]{1,9}$' then v_raw::integer end;
    if v_global is not null and (
         select count(*) from public.bot_messages m
          where m.role = 'user' and m.conversation_id not like 'owner:%'
            and m.created_at >= now() - interval '1 day'
       ) >= v_global then
      return query select null::bigint, 'global_day'::text;
      return;
    end if;
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

revoke all on function public.insert_bot_message(uuid, text, text, text, text, text, bigint, integer, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.insert_bot_message(uuid, text, text, text, text, text, bigint, integer, text, integer, integer, integer)
  to service_role;
