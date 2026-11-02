-- Supabase Auth (admin.createUser) сначала вставляет пользователя, а app_metadata
-- (login, nickname, group_id, age_band, created_by) записывает следующим UPDATE.
-- Поэтому on_auth_user_created видит пустые метаданные: ученик остаётся без группы
-- и без стартовых звёзд. Этот триггер доводит профиль до конца, когда метаданные пришли,
-- и один раз начисляет стартовые звёзды. Плюс разовое исправление уже созданных учеников.

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

  -- Заполняем только то, чего ещё нет: уже назначенную группу и роль не трогаем
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

  -- Стартовые звёзды — один раз (в журнале есть уникальный индекс на reason = 'welcome')
  if exists (select 1 from public.star_ledger where user_id = p_user and reason = 'welcome') then
    return;
  end if;

  v_welcome := coalesce((select (s.value #>> '{}')::integer from public.settings s
                          where s.key = 'welcome_stars'), 1000);
  if v_welcome <= 0 then
    return;
  end if;

  insert into public.wallets (user_id, balance) values (p_user, 0)
  on conflict (user_id) do nothing;

  update public.wallets set balance = balance + v_welcome
   where user_id = p_user
  returning balance into v_balance;

  insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note)
  values (p_user, v_welcome, 'welcome', v_balance, v_creator, 'Стартовые звёзды');
end $$;

revoke all on function private.apply_student_meta(uuid, jsonb) from public, anon, authenticated;

create or replace function private.handle_user_meta_updated()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_app_meta_data is distinct from old.raw_app_meta_data then
    perform private.apply_student_meta(new.id, new.raw_app_meta_data);
  end if;
  return new;
end $$;

revoke all on function private.handle_user_meta_updated() from public, anon, authenticated;

drop trigger if exists on_auth_user_meta_updated on auth.users;
create trigger on_auth_user_meta_updated
  after update of raw_app_meta_data on auth.users
  for each row execute function private.handle_user_meta_updated();

-- Разово: ученики, созданные до этой миграции (профиль без группы, а в метаданных группа есть)
do $$
declare
  r record;
begin
  for r in
    select u.id, u.raw_app_meta_data
      from auth.users u
      join public.profiles p on p.id = u.id
     where p.group_id is null
       and nullif(u.raw_app_meta_data ->> 'group_id', '') is not null
  loop
    perform private.apply_student_meta(r.id, r.raw_app_meta_data);
  end loop;
end $$;
