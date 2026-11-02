-- Бюджет группы вместо дневного лимита и общих стартовых 1000★ (решение Сени от 3 ноября 2026).
-- Учитель задаёт бюджет группы и число учеников; каждый ученик группы получает
-- stars_per_student на весь курс. Дневной лимит больше не ограничивает (ставим максимум).
-- Ручное начисление учителем (grant_stars) не меняется.

alter table public.groups
  add column if not exists budget_stars      integer check (budget_stars between 0 and 100000000),
  add column if not exists planned_students  integer check (planned_students between 1 and 1000),
  add column if not exists stars_per_student integer check (stars_per_student between 0 and 1000000);

-- Дневной лимит выключен: максимум, который допускает проверка столбца
alter table public.groups alter column daily_cap set default 1000000;
update public.groups set daily_cap = 1000000;
update public.settings set value = 'null'::jsonb where key = 'global_daily_cap';

-- Общих стартовых звёзд больше нет: звёзды даёт группа
update public.settings set value = '0'::jsonb where key = 'welcome_stars';

-- Профиль из метаданных Auth + стартовые звёзды группы (один раз)
create or replace function private.apply_student_meta(p_user uuid, p_meta jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_meta    jsonb := coalesce(p_meta, '{}'::jsonb);
  v_login   text := nullif(lower(btrim(v_meta ->> 'login')), '');
  v_group   uuid := nullif(v_meta ->> 'group_id', '')::uuid;
  v_creator uuid := nullif(v_meta ->> 'created_by', '')::uuid;
  v_age     public.age_band := nullif(v_meta ->> 'age_band', '')::public.age_band;
  v_nick    text := left(nullif(btrim(v_meta ->> 'nickname'), ''), 40);
  v_profile public.profiles%rowtype;
  v_welcome integer;
  v_balance integer;
begin
  if v_group is null then
    return;
  end if;

  select * into v_profile from public.profiles where id = p_user for update;
  if not found then
    return;
  end if;

  if v_profile.group_id is null then
    update public.profiles p
       set login      = coalesce(p.login, v_login),
           nickname   = coalesce(v_nick, p.nickname),
           group_id   = v_group,
           age_band   = coalesce(v_age, p.age_band),
           created_by = coalesce(p.created_by, v_creator)
     where p.id = p_user;
  end if;

  if v_profile.role <> 'student' then
    return;
  end if;

  if exists (select 1 from public.star_ledger where user_id = p_user and reason = 'welcome') then
    return;
  end if;

  v_welcome := coalesce(
    (select g.stars_per_student from public.groups g where g.id = v_group),
    (select (s.value #>> '{}')::integer from public.settings s where s.key = 'welcome_stars'),
    0);
  if v_welcome <= 0 then
    return;
  end if;

  insert into public.wallets (user_id, balance) values (p_user, 0)
  on conflict (user_id) do nothing;

  update public.wallets set balance = balance + v_welcome
   where user_id = p_user
  returning balance into v_balance;

  insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note)
  values (p_user, v_welcome, 'welcome', v_balance, v_creator, 'Звёзды на курс от группы');
end $$;

revoke all on function private.apply_student_meta(uuid, jsonb) from public, anon, authenticated;

-- Создание пользователя: профиль и пустой кошелёк, дальше — одна общая логика
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_nick text := left(coalesce(
                nullif(btrim(v_meta ->> 'nickname'), ''),
                nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                'user'), 40);
begin
  insert into public.profiles (id, login, nickname, created_by)
  values (new.id, null, v_nick, nullif(v_meta ->> 'created_by', '')::uuid);

  insert into public.wallets (user_id, balance) values (new.id, 0);

  perform private.apply_student_meta(new.id, v_meta);
  return new;
end $$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
