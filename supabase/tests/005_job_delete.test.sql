-- Мягкое удаление результата (jobs.deleted_at): общая галерея, права, звёзды не возвращаются.
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ---------- данные: учитель, группа с общей галереей, ученики Анна и Борис ----------
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000051', 'teacher51@example.test');
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000051';
insert into public.groups (id, code, title, teacher_id, stars_per_student, share_gallery) values
  ('b0000000-0000-4000-8000-000000000051', 'g51', 'Группа 51', 'a0000000-0000-4000-8000-000000000051', 100, true);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000051', 'g51-anna@students.example.test',
   '{"login": "g51-anna", "nickname": "Анна", "group_id": "b0000000-0000-4000-8000-000000000051"}'),
  ('c0000000-0000-4000-8000-000000000052', 'g51-boris@students.example.test',
   '{"login": "g51-boris", "nickname": "Борис", "group_id": "b0000000-0000-4000-8000-000000000051"}');

-- у Анны две готовые картинки по 2 ★; одну она удаляет
set local role service_role;
select job_id from public.create_job('c0000000-0000-4000-8000-000000000051', 'image', 'flux-3/klein-text-to-image', 2, 'del-anna-0001');
select job_id from public.create_job('c0000000-0000-4000-8000-000000000051', 'image', 'flux-3/klein-text-to-image', 2, 'del-anna-0002');
select public.complete_job(id, user_id || '/' || id || '.jpg') from public.jobs where user_id = 'c0000000-0000-4000-8000-000000000051';

select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'jobs' and column_name = 'deleted_at'), 1,
  'у jobs есть колонка deleted_at');

update public.jobs set deleted_at = now() where idempotency_key = 'del-anna-0002';
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-000000000051' and deleted_at is not null), 1,
  'сервер отметил задачу удалённой');
select is((select status::text from public.jobs where idempotency_key = 'del-anna-0002'), 'done',
  'статус удалённой задачи не меняется (строка остаётся для отчётов)');

-- звёзды не возвращаются: возврат по готовой задаче — ноль, в журнале только списания
select is((select refunded from public.refund_job((select id from public.jobs where idempotency_key = 'del-anna-0002'), 'deleted')), 0,
  'удаление не возвращает звёзды');
select is((select count(*)::int from public.star_ledger where user_id = 'c0000000-0000-4000-8000-000000000051' and reason = 'refund'), 0,
  'в журнале звёзд нет возврата');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000051'), 96,
  'баланс Анны: 100 − 2 − 2, удаление ничего не вернуло');

-- ---------- одногруппник Борис: общая галерея без удалённого ----------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000052", "role": "authenticated"}';
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-000000000051'), 1,
  'одногруппник видит в общей галерее только неудалённую задачу');

-- ---------- Анна: свои строки видит (сервер фильтрует сам), менять не может ----------
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000051", "role": "authenticated"}';
select is((select count(*)::int from public.jobs), 2, 'владелец видит и удалённую строку (фильтрует сервер)');
select throws_ok($$ update public.jobs set deleted_at = null where idempotency_key = 'del-anna-0002' $$, '42501', null,
  'клиент не снимает и не ставит отметку удаления сам');

select * from finish();
rollback;
