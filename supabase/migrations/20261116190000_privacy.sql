-- ============================================================================
-- Личные данные: удаление, сроки хранения, согласие, доступ (аудит 8 ноября, № 23, 25, 38, 55,
-- 57, 58; docs/platform/audit/2026-11-09-verified.md: BP-4, SEC-04, SEC-05, DB-03, SEC-06, DB-10).
--
-- 1. lock_for_spend (№ 38): строку группы блокируем и траты дня суммируем только когда у группы
--    действительно включён дневной лимит (daily_cap < 1 000 000 — «выключен» с 20261103110000).
--    Пауза группы читается без блокировки. Остальное — как в 20261105100000_security_hardening.
-- 2. groups (№ 57): клиентам (authenticated) — только колонки, которые читает приложение
--    (id, code, title, paused, ends_on, allow_google_minors, share_gallery). Бюджет, teacher_id,
--    daily_cap ученику больше не видны. Кабинет ведущего читает группы admin-клиентом.
-- 3. jobs_read (№ 57): ветка «общая галерея» убрана из RLS — она отдавала одногруппникам всю
--    строку (полный промпт, параметры, кредиты). Общую галерею теперь отдаёт сервер
--    admin-клиентом с теми же условиями и нужными колонками. Своё и группы ведущего — как раньше.
-- 4. profiles (№ 25): как получено согласие родителей (parental_consent_method) и кто его
--    отметил (parental_consent_by). Дата — прежняя parental_consent_at. Документов и данных
--    родителей не храним. Существующие строки не меняются (способ и кто — пусто).
-- 5. sweep_bot_guest_data (№ 23): сроки хранения гостевых данных ботов. Удаляет переписку
--    гостей старше p_message_days дней (кроме проверки владельцем, conversation_id 'owner:…')
--    и заявки ботов учеников, у чьей группы последний урок (ends_on) был больше p_lead_days
--    дней назад. Не больше p_limit строк каждой таблицы за вызов. Вызывает ночной обход
--    /api/jobs/sweep (lib/server/retention.ts). Аккаунты учеников автоматически не удаляются.
-- 6. delete_student_data (№ 23): админ удаляет ученика и все его данные (каскадом от профиля:
--    кошелёк, журнал звёзд, задачи, тесты, прогресс, домашки, бот с перепиской и заявками).
--    Файлы Storage сервер удаляет до вызова (Storage API). В audit_log — одна строка без
--    личных данных (только счётчики); логин ученика вычищается из прошлых записей журнала.
--
-- Безопасно на боевых данных: новые колонки без значений по умолчанию (без перезаписи
-- таблицы), check-ограничение верно для всех существующих строк, данные удаляются только
-- новыми функциями и только когда их вызывают. Миграцию можно применить повторно.
-- Новые функции — security definer, search_path = '', выполнять может только service_role.
-- Тесты: supabase/tests/012_privacy.test.sql.
-- ============================================================================

-- ===== 1. lock_for_spend: блокировка группы только при включённом дневном лимите =====

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
    -- обычное чтение: без лимита дня строку группы не держим (одна горячая строка на всю группу)
    select g.paused, g.daily_cap into v_paused, v_cap from public.groups g where g.id = v_group_id;
    if v_paused then raise exception 'group_paused' using errcode = 'P0001'; end if;
    if p_count_cap and v_cap < 1000000 then
      -- лимит включён: «сумма за день + списание» должны идти по очереди для всей группы
      select g.paused, g.daily_cap into v_paused, v_cap from public.groups g where g.id = v_group_id for update;
      if v_paused then raise exception 'group_paused' using errcode = 'P0001'; end if;
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

-- ===== 2. groups: клиентам — только нужные колонки ==============================
-- Ученик читает свою группу встраиванием в профиль (lib/server/dal/auth.ts: id, code, title,
-- paused, allow_google_minors, share_gallery, ends_on). Политика groups_read не меняется.

revoke select on public.groups from authenticated;
grant select (id, code, title, paused, ends_on, allow_google_minors, share_gallery) on public.groups to authenticated;

-- ===== 3. jobs_read: без ветки общей галереи ==================================

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_group(group_id));

-- ===== 4. Согласие родителей: как и кто отметил ================================
-- paper_centre — письменное согласие родителей хранится у центра;
-- electronic_centre — электронное согласие родителей (форма центра) хранится у центра.

alter table public.profiles add column if not exists parental_consent_method text;
alter table public.profiles add column if not exists parental_consent_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_consent_method_check') then
    alter table public.profiles add constraint profiles_consent_method_check
      check (parental_consent_method is null or parental_consent_method in ('paper_centre', 'electronic_centre'));
  end if;
  -- способ и кто — только вместе с отметкой согласия
  if not exists (select 1 from pg_constraint where conname = 'profiles_consent_fields_check') then
    alter table public.profiles add constraint profiles_consent_fields_check
      check (parental_consent_at is not null or (parental_consent_method is null and parental_consent_by is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_consent_by_fk') then
    alter table public.profiles add constraint profiles_consent_by_fk
      foreign key (parental_consent_by) references public.profiles (id) on delete set null;
  end if;
end $$;

-- ===== 5. Сроки хранения гостевых данных ботов =================================

-- Возвращает, сколько строк удалено. p_message_days и p_lead_days — не меньше 7 (ошибка
-- в вызове не сотрёт свежие данные), p_limit — от 1 до 5000 на таблицу за вызов.
create or replace function public.sweep_bot_guest_data(
  p_message_days integer default 30,
  p_lead_days    integer default 30,
  p_limit        integer default 5000
) returns table (messages integer, leads integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_messages integer := 0;
  v_leads    integer := 0;
  v_today    date := (now() at time zone 'Europe/Berlin')::date;
begin
  if p_message_days is null or p_message_days < 7 or p_lead_days is null or p_lead_days < 7
     or p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'bad_input' using errcode = 'P0001';
  end if;

  -- переписка гостей (веб и Telegram); проверка владельцем в конструкторе (owner:…) — не гости
  delete from public.bot_messages m
   where m.id in (
     select x.id from public.bot_messages x
      where x.created_at < now() - make_interval(days => p_message_days)
        and x.conversation_id not like 'owner:%'
      order by x.created_at
      limit p_limit);
  get diagnostics v_messages = row_count;

  -- заявки ботов учеников: через p_lead_days дней после последнего урока группы.
  -- Боты ведущих и группы без даты окончания — не трогаем (удаление вручную).
  delete from public.bot_leads l
   where l.id in (
     select x.id from public.bot_leads x
       join public.bots b on b.id = x.bot_id
       join public.profiles p on p.id = b.owner_id
       join public.groups g on g.id = p.group_id
      where p.role = 'student' and g.ends_on is not null
        and g.ends_on + p_lead_days < v_today
      order by x.created_at
      limit p_limit);
  get diagnostics v_leads = row_count;

  return query select v_messages, v_leads;
end $$;

revoke all on function public.sweep_bot_guest_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.sweep_bot_guest_data(integer, integer, integer) to service_role;

-- ===== 6. Удалить ученика и все его данные ====================================

-- Только админ (не отключённый) и только аккаунт ученика. Файлы Storage удаляет сервер ДО вызова
-- (p_files — сколько удалено, для журнала). Удаление необратимо: строки уходят каскадом от
-- профиля, журнал звёзд — тоже (триггер ledger_append_only разрешает каскад).
-- Учётную запись входа (auth.users) функция удаляет сама; если прав на auth.users нет, удаляет
-- профиль и возвращает auth_deleted = false — тогда сервер удаляет вход через Auth Admin API.
create or replace function public.delete_student_data(p_actor uuid, p_user uuid, p_files integer default 0)
returns table (group_id uuid, jobs integer, homework integer, bot_messages integer, bot_leads integer,
               ledger integer, auth_deleted boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_role      public.app_role;
  v_group     uuid;
  v_login     text;
  v_jobs      integer;
  v_homework  integer;
  v_messages  integer;
  v_leads     integer;
  v_ledger    integer;
  v_auth      boolean := false;
begin
  if not exists (select 1 from public.profiles a where a.id = p_actor and a.role = 'admin' and not a.disabled) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select p.role, p.group_id, p.login into v_role, v_group, v_login
    from public.profiles p where p.id = p_user for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  if v_role <> 'student' then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select count(*) into v_jobs from public.jobs j where j.user_id = p_user;
  select count(*) into v_homework from public.homework_submissions h where h.user_id = p_user;
  select count(*) into v_messages from public.bot_messages m join public.bots b on b.id = m.bot_id where b.owner_id = p_user;
  select count(*) into v_leads from public.bot_leads l join public.bots b on b.id = l.bot_id where b.owner_id = p_user;
  select count(*) into v_ledger from public.star_ledger l where l.user_id = p_user;

  -- Журнал аудита: логин ученика из записи о создании пачки, ссылки на ученика и
  -- адрес его бота (slug, имя в Telegram) из остальных записей. Сами действия остаются.
  if v_login is not null then
    update public.audit_log a
       set meta = jsonb_set(a.meta, '{logins}', coalesce(
             (select jsonb_agg(x) from jsonb_array_elements(a.meta -> 'logins') x where x <> to_jsonb(v_login)),
             '[]'::jsonb))
     where a.action = 'students.create' and jsonb_typeof(a.meta -> 'logins') = 'array'
       and a.meta -> 'logins' @> jsonb_build_array(v_login);
  end if;
  update public.audit_log a
     set meta = a.meta - 'slug' - 'username',
         target_user = case when a.target_user = p_user then null else a.target_user end,
         actor_id = case when a.actor_id = p_user then null else a.actor_id end
   where a.target_user = p_user or a.actor_id = p_user;

  insert into public.audit_log (actor_id, action, target_group, meta)
  values (p_actor, 'student.data_delete', v_group,
          jsonb_build_object('jobs', v_jobs, 'homework', v_homework, 'bot_messages', v_messages,
                             'bot_leads', v_leads, 'ledger', v_ledger, 'files', greatest(coalesce(p_files, 0), 0)));

  begin
    delete from auth.users u where u.id = p_user;
    v_auth := found;
  exception when undefined_table or insufficient_privilege then
    v_auth := false;
  end;
  -- без auth.users (или без прав на неё) — удаляем профиль, каскад тот же
  delete from public.profiles p where p.id = p_user;

  return query select v_group, v_jobs, v_homework, v_messages, v_leads, v_ledger, v_auth;
end $$;

revoke all on function public.delete_student_data(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_student_data(uuid, uuid, integer) to service_role;
