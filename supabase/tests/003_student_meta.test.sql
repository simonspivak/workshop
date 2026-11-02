-- Ученик, созданный как в Supabase Auth: сначала INSERT без метаданных,
-- потом UPDATE raw_app_meta_data. Профиль должен получить группу, а кошелёк — 1000★ один раз.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000002', 'teacher1@example.test');
update public.profiles set role = 'teacher', age_band = 'adult'
 where id = 'a0000000-0000-4000-8000-000000000002';
insert into public.groups (id, code, title, teacher_id) values
  ('b0000000-0000-4000-8000-000000000001', 'md1', 'Группа 1', 'a0000000-0000-4000-8000-000000000002');

-- шаг 1: как в Auth — пользователь без наших метаданных
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-0000000000d1', 'md1-matvey@students.example.com',
   '{"provider": "email", "providers": ["email"]}');

select is((select group_id from public.profiles where id = 'c0000000-0000-4000-8000-0000000000d1'),
          null, 'после INSERT группы ещё нет');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-0000000000d1'),
          0, 'после INSERT звёзд ещё нет');

-- шаг 2: Auth дописывает app_metadata
update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"login": "md1-matvey", "nickname": "Матвей",
       "group_id": "b0000000-0000-4000-8000-000000000001", "age_band": "16_17",
       "created_by": "a0000000-0000-4000-8000-000000000002"}'::jsonb
 where id = 'c0000000-0000-4000-8000-0000000000d1';

select is((select group_id::text from public.profiles where id = 'c0000000-0000-4000-8000-0000000000d1'),
          'b0000000-0000-4000-8000-000000000001', 'после UPDATE ученик в группе');
select is((select login from public.profiles where id = 'c0000000-0000-4000-8000-0000000000d1'),
          'md1-matvey', 'логин записан');
select is((select nickname from public.profiles where id = 'c0000000-0000-4000-8000-0000000000d1'),
          'Матвей', 'ник записан');
select is((select age_band::text from public.profiles where id = 'c0000000-0000-4000-8000-0000000000d1'),
          '16_17', 'возраст записан');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-0000000000d1'),
          1000, 'стартовые 1000 звёзд');

-- повторное изменение метаданных не начисляет второй раз
update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"note": "x"}'::jsonb
 where id = 'c0000000-0000-4000-8000-0000000000d1';
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-0000000000d1'),
          1000, 'повтор не начисляет');
select is((select count(*)::int from public.star_ledger
            where user_id = 'c0000000-0000-4000-8000-0000000000d1' and reason = 'welcome'),
          1, 'в журнале одна запись welcome');

select * from finish();
rollback;
