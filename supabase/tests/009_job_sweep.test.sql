-- Брошенные задачи в очереди (аудит № 16): create_job возвращает звёзды за свои queued без taskId
-- старше 90 с до подсчёта лимита 5. Монтаж, задачи с taskId, свежие и чужие не трогает.
-- Запуск: `supabase test db` или `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ---------- данные: ведущий, группа (100★ на ученика), ученики Анна и Борис ----------
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000081', 'teacher81@example.test');
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000081';
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000081', 'g81', 'Группа 81', 'a0000000-0000-4000-8000-000000000081', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000081', 'g81-anna@students.example.test',
   '{"login": "g81-anna", "nickname": "Анна", "group_id": "b0000000-0000-4000-8000-000000000081"}'),
  ('c0000000-0000-4000-8000-000000000082', 'g81-boris@students.example.test',
   '{"login": "g81-boris", "nickname": "Борис", "group_id": "b0000000-0000-4000-8000-000000000081"}');

-- Анна: три текста (по 1★), картинка у шлюза (2★), монтаж (0★) — пять активных задач
set local role service_role;
select job_id from public.create_job('c0000000-0000-4000-8000-000000000081', 'text', 'claude-haiku-5-5', 1, 'sw-text-0001');
select job_id from public.create_job('c0000000-0000-4000-8000-000000000081', 'text', 'claude-haiku-5-5', 1, 'sw-text-0002');
select job_id from public.create_job('c0000000-0000-4000-8000-000000000081', 'text', 'claude-haiku-5-5', 1, 'sw-text-0003');
select job_id from public.create_job('c0000000-0000-4000-8000-000000000081', 'image', 'flux-3/klein-text-to-image', 2, 'sw-image-001');
select public.mark_job_submitted((select id from public.jobs where idempotency_key = 'sw-image-001'), 'task-sw-1');
select job_id from public.create_job('c0000000-0000-4000-8000-000000000081', 'montage', 'platform/auto-montage', 0, 'sw-montage-1');
-- Борис: брошенный текст
select job_id from public.create_job('c0000000-0000-4000-8000-000000000082', 'text', 'claude-haiku-5-5', 1, 'sw-boris-001');

select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000081', 'text',
                    'claude-haiku-5-5', 1, 'sw-text-0004') $$, 'P0001', 'too_many_jobs',
  'пять свежих активных задач: шестая не создаётся');

-- Запросы, которые вели два первых текста, «умерли» 4 минуты назад; картинка и монтаж — тоже давно
reset role;
update public.jobs set created_at = now() - interval '4 minutes'
 where idempotency_key in ('sw-text-0001', 'sw-text-0002', 'sw-montage-1', 'sw-boris-001');
update public.jobs set created_at = now() - interval '4 minutes', submitted_at = now() - interval '4 minutes'
 where idempotency_key = 'sw-image-001';
-- третий текст — 60 с: его запрос ещё может быть жив
update public.jobs set created_at = now() - interval '60 seconds' where idempotency_key = 'sw-text-0003';
set local role service_role;

select is((select balance from public.create_job('c0000000-0000-4000-8000-000000000081', 'text',
            'claude-haiku-5-5', 1, 'sw-text-0004')), 96,
  'новая задача создана; баланс 100 − 5 + 2 (возврат) − 1 = 96');
select is((select status::text from public.jobs where idempotency_key = 'sw-text-0001'), 'failed',
  'брошенный текст закрыт');
select is((select error from public.jobs where idempotency_key = 'sw-text-0002'), 'gateway_lost: stale queued',
  'причина — gateway_lost (код для ученика)');
select is((select count(*)::int from public.star_ledger l join public.jobs j on j.id = l.job_id
            where j.user_id = 'c0000000-0000-4000-8000-000000000081' and l.reason = 'refund'), 2,
  'в журнале два возврата по 1★');
select is((select status::text from public.jobs where idempotency_key = 'sw-text-0003'), 'queued',
  'текст моложе 90 с не трогаем');
select is((select status::text from public.jobs where idempotency_key = 'sw-image-001'), 'submitted',
  'задачу с taskId ведёт опрос, не create_job');
select is((select status::text from public.jobs where idempotency_key = 'sw-montage-1'), 'queued',
  'монтаж (загрузка из браузера) не трогаем');
select is((select status::text from public.jobs where idempotency_key = 'sw-boris-001'), 'queued',
  'чужую брошенную задачу не трогаем');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000082'), 99,
  'звёзды Бориса не меняются');

-- повтор с тем же ключом: та же задача, без второго возврата и списания
select is((select reused from public.create_job('c0000000-0000-4000-8000-000000000081', 'text',
            'claude-haiku-5-5', 1, 'sw-text-0004')), true, 'повтор возвращает ту же задачу');
select is((select count(*)::int from public.star_ledger l join public.jobs j on j.id = l.job_id
            where j.user_id = 'c0000000-0000-4000-8000-000000000081' and l.reason = 'refund'), 2,
  'второго возврата нет');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000081'), 96,
  'баланс Анны не изменился');

select * from finish();
rollback;
