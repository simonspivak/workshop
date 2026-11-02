-- RLS и гранты: кто что видит и что может менять.
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ---------- данные: админ, два учителя, две группы, три ученика ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'teacher1@example.test'),
  ('a0000000-0000-4000-8000-000000000003', 'teacher2@example.test');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003');

insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000001', 'g1', 'Группа 1', 'a0000000-0000-4000-8000-000000000002', 1000),
  ('b0000000-0000-4000-8000-000000000002', 'g2', 'Группа 2', 'a0000000-0000-4000-8000-000000000003', 1000);

insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-00000000000a', 'g1-anna@students.example.test',
   '{"login": "g1-anna", "nickname": "Анна", "group_id": "b0000000-0000-4000-8000-000000000001"}'),
  ('c0000000-0000-4000-8000-00000000000b', 'g1-boris@students.example.test',
   '{"login": "g1-boris", "nickname": "Борис", "group_id": "b0000000-0000-4000-8000-000000000001"}'),
  ('c0000000-0000-4000-8000-00000000000c', 'g2-vera@students.example.test',
   '{"login": "g2-vera", "nickname": "Вера", "group_id": "b0000000-0000-4000-8000-000000000002"}');

-- задачи: у Анны одна готовая, у Бориса одна готовая и одна скрытая, у Веры одна
set local role service_role;
select job_id from public.create_job('c0000000-0000-4000-8000-00000000000a', 'image', 'flux-3/klein-text-to-image', 2, 'rls-anna-0001');
select job_id from public.create_job('c0000000-0000-4000-8000-00000000000b', 'image', 'flux-3/klein-text-to-image', 2, 'rls-boris-0001');
select job_id from public.create_job('c0000000-0000-4000-8000-00000000000b', 'image', 'flux-3/klein-text-to-image', 2, 'rls-boris-0002');
select job_id from public.create_job('c0000000-0000-4000-8000-00000000000c', 'image', 'flux-3/klein-text-to-image', 2, 'rls-vera-0001');
select public.complete_job(id, user_id || '/' || id || '.jpg') from public.jobs;
update public.jobs set hidden = true where idempotency_key = 'rls-boris-0002';
insert into public.bots (owner_id, slug, name, telegram_token_ciphertext, telegram_token_iv, telegram_token_tag)
values ('c0000000-0000-4000-8000-00000000000a', 'anna-bot', 'Бот Анны', 'cipher', 'iv', 'tag'),
       ('c0000000-0000-4000-8000-00000000000c', 'vera-bot', 'Бот Веры', null, null, null);
reset role;
insert into storage.objects (bucket_id, name) values
  ('media', 'c0000000-0000-4000-8000-00000000000a/one.jpg'),
  ('media', 'c0000000-0000-4000-8000-00000000000b/two.jpg');

-- ---------- ученица Анна ----------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';

select is((select count(*)::int from public.profiles), 1, 'ученик видит только свой профиль');
select is((select count(*)::int from public.profiles where id = 'c0000000-0000-4000-8000-00000000000b'), 0,
  'ученик А не видит профиль ученика Б из своей же группы');
select is((select count(*)::int from public.wallets), 1, 'ученик видит только свой кошелёк');
select is((select count(*)::int from public.star_ledger where user_id <> auth.uid()), 0, 'чужой журнал звёзд не виден');
select is((select count(*)::int from public.jobs), 1, 'ученик видит только свои задачи (галерея группы выключена)');
select is((select count(*)::int from public.groups), 1, 'ученик видит только свою группу');
select is((select count(*)::int from public.bots), 1, 'ученик видит только своего бота');
select is((select count(*)::int from storage.objects), 1, 'в Storage ученик видит только свою папку');
select ok((select count(*) from public.price_list) > 0, 'прайс виден вошедшему пользователю');

select throws_ok($$ update public.wallets set balance = 99999 $$, '42501', null, 'нельзя менять баланс');
select throws_ok($$ insert into public.star_ledger (user_id, delta, reason, balance_after)
                    values (auth.uid(), 5000, 'grant', 6000) $$, '42501', null, 'нельзя писать в журнал звёзд');
select throws_ok($$ update public.profiles set role = 'admin' where id = auth.uid() $$, '42501', null,
  'нельзя повысить себе роль');
select throws_ok($$ update public.profiles set age_band = 'adult' where id = auth.uid() $$, '42501', null,
  'нельзя поменять себе возраст');
select throws_ok($$ insert into public.jobs (user_id, action, model, idempotency_key)
                    values (auth.uid(), 'image', 'x', 'direct-00001') $$, '42501', null, 'нельзя создать задачу напрямую');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'image',
                    'flux-3/klein-text-to-image', 0, 'self-free-0001') $$, '42501', null, 'нельзя вызвать списание самому');
select throws_ok($$ select public.grant_stars('c0000000-0000-4000-8000-00000000000a',
                    'c0000000-0000-4000-8000-00000000000a', 5000) $$, '42501', null, 'нельзя начислить себе звёзды');
select throws_ok($$ select * from public.refund_job('c0000000-0000-4000-8000-00000000000a', 'x') $$, '42501', null,
  'нельзя вызвать возврат');
select throws_ok($$ select * from public.record_quiz_attempt('c0000000-0000-4000-8000-00000000000a',
                    'lesson-1', '[]', 10, 10, 100) $$, '42501', null, 'нельзя записать себе тест с бонусом');
select throws_ok($$ select private.lock_for_spend('c0000000-0000-4000-8000-00000000000a', 1, true) $$, '42501', null,
  'внутренние функции закрыты');
select throws_ok($$ select * from public.settings $$, '42501', null, 'settings недоступны');
select throws_ok($$ select telegram_token_ciphertext from public.bots $$, '42501', null,
  'шифротекст токена бота недоступен клиенту');
select lives_ok($$ select id, slug, name, soul, tools, telegram_bot_username from public.bots $$,
  'открытые поля бота читаются');
select is((select count(*)::int from public.audit_log), 0, 'ученик не видит журнал аудита');

-- ---------- общая галерея группы ----------
reset role;
update public.groups set share_gallery = true where id = 'b0000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select is((select count(*)::int from public.jobs), 2,
  'с общей галереей видны готовые нескрытые работы одногруппников');
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-00000000000c'), 0,
  'работы другой группы не видны');
select is((select count(*)::int from public.profiles), 1, 'общая галерея не открывает профили одногруппников');

-- ---------- учитель 1 ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select is((select count(*)::int from public.groups), 1, 'учитель видит только свою группу');
select is((select count(*)::int from public.profiles where role = 'student'), 2, 'учитель видит учеников своей группы');
select is((select count(*)::int from public.profiles where group_id = 'b0000000-0000-4000-8000-000000000002'), 0,
  'учитель не видит учеников чужой группы');
select is((select count(*)::int from public.wallets), 3, 'учитель видит свой кошелёк и кошельки своих учеников');
select is((select count(*)::int from public.jobs), 3, 'учитель видит все задачи своей группы, включая скрытые');
select is((select count(*)::int from public.bots), 1, 'учитель видит ботов своих учеников');
select is((select count(*)::int from public.audit_log), 0, 'учитель не видит журнал аудита');
select throws_ok($$ update public.groups set paused = true $$, '42501', null, 'учитель не пишет в базу напрямую');

-- ---------- учитель 2 ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000003", "role": "authenticated"}';
select is((select count(*)::int from public.profiles where role = 'student'), 1, 'учитель 2 видит только свою ученицу');
select is((select count(*)::int from public.star_ledger where user_id = 'c0000000-0000-4000-8000-00000000000a'), 0,
  'учитель 2 не видит звёзды чужих учеников');

-- ---------- админ ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select is((select count(*)::int from public.profiles), 6, 'админ видит всех');
select is((select count(*)::int from public.groups), 2, 'админ видит все группы');
select is((select count(*)::int from public.wallets), 6, 'админ видит все кошельки, включая учителей');
select is((select count(*)::int from public.jobs), 4, 'админ видит все задачи');

-- ---------- аноним ----------
reset role;
set local role anon;
select throws_ok($$ select * from public.profiles $$, '42501', null, 'аноним не читает профили');
select throws_ok($$ select * from public.price_list $$, '42501', null, 'аноним не читает прайс');

-- ---------- общие свойства схемы ----------
reset role;
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0,
  'RLS включён на каждой таблице public');
select is((select count(*)::int from information_schema.role_table_grants
            where grantee = 'anon' and table_schema = 'public'), 0, 'у anon нет прав ни на одну таблицу');
select is((select count(*)::int from information_schema.role_table_grants
            where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'), 0,
  'у authenticated нет прав на запись');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and (has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('anon', p.oid, 'execute'))), 0,
  'ни одна функция public не вызывается клиентами');

select * from finish();
rollback;
