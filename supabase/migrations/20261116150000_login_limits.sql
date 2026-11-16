-- ============================================================================
-- Вход: лимит по IP считает только неудачи, журнал входов ведущих
-- (аудит 8 ноября, № 5 и № 59; docs/platform/audit/2026-11-09-verified.md: AUTH-1, DB-08,
-- SEC-02, SEC-09).
--
-- 1. rate_limit_take — как rate_limit_hit (20261105100000), но возвращает id засчитанной
--    попытки (null — лимит исчерпан). Попытка с IP занимается до проверки пароля, под той же
--    advisory-блокировкой ключа, поэтому параллельные входы не проходят сверх лимита.
-- 2. rate_limit_refund — вернуть ровно эту попытку (по id и ключу), когда пароль верный
--    или Supabase Auth ответил 429. Чужие неудачи с того же IP не трогаются (в отличие от
--    rate_limit_reset, который удаляет весь ключ и обнулил бы защиту от перебора).
--    Итог: успешные входы класса бюджет IP не тратят, неудачи — тратят.
-- 3. staff_id_by_email — id аккаунта ведущего или админа по адресу входа (иначе null):
--    неудачный вход ведущего пишется в audit_log с этим id, неудачи учеников — нет.
--
-- Таблица private.rate_limit_hits не меняется, старые функции остаются (их зовёт прежний код
-- до деплоя). Существующие строки не трогаются; миграцию можно применить повторно.
-- Тесты: supabase/tests/008_login_limits.test.sql.
-- ============================================================================

-- ===== 1. Занять попытку (с id) ==============================================

create or replace function public.rate_limit_take(p_key text, p_limit integer, p_window_seconds integer)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_id    bigint;
begin
  if p_key is null or char_length(p_key) not between 8 and 200
     or p_limit is null or p_limit not between 1 and 100000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'bad_rate_limit' using errcode = 'P0001';
  end if;

  -- та же блокировка, что у rate_limit_hit: оба способа считают один ключ согласованно
  perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_key, 0));

  delete from private.rate_limit_hits h
   where h.key = p_key and h.hit_at < now() - make_interval(secs => p_window_seconds);
  if random() < 0.02 then
    delete from private.rate_limit_hits h where h.hit_at < now() - interval '1 day';
  end if;

  select count(*) into v_count from private.rate_limit_hits h where h.key = p_key;
  if v_count >= p_limit then
    return null;
  end if;
  insert into private.rate_limit_hits (key) values (p_key) returning id into v_id;
  return v_id;
end $$;

-- ===== 2. Вернуть свою попытку ===============================================

create or replace function public.rate_limit_refund(p_key text, p_hit_id bigint)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from private.rate_limit_hits h where h.id = p_hit_id and h.key = p_key returning 1
  )
  select exists (select 1 from gone)
$$;

-- ===== 3. Аккаунт ведущего по адресу входа ===================================

-- Supabase Auth хранит адреса в нижнем регистре; форма входа тоже приводит к нему.
create or replace function public.staff_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
    from auth.users u
    join public.profiles p on p.id = u.id
   where u.email = lower(p_email)
     and p.role in ('teacher', 'admin')
   limit 1
$$;

revoke all on function public.rate_limit_take(text, integer, integer),
                       public.rate_limit_refund(text, bigint),
                       public.staff_id_by_email(text)
  from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, integer, integer),
                          public.rate_limit_refund(text, bigint),
                          public.staff_id_by_email(text)
  to service_role;
