-- Потолки ведущих: дневной потолок кредитов kie в create_job, лимиты начислений в grant_stars,
-- рубильник generation_enabled. Запуск: `supabase test db` или `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ---------- данные: админ, два ведущих, по ученику в группе ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000071', 'admin71@example.test'),
  ('a0000000-0000-4000-8000-000000000072', 'teacher72@example.test'),
  ('a0000000-0000-4000-8000-000000000073', 'teacher73@example.test');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000071';
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000072', 'a0000000-0000-4000-8000-000000000073');
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000072', 'g72', 'Группа 72', 'a0000000-0000-4000-8000-000000000072', 100),
  ('b0000000-0000-4000-8000-000000000073', 'g73', 'Группа 73', 'a0000000-0000-4000-8000-000000000073', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000072', 'g72-ira@students.example.test',
   '{"login": "g72-ira", "nickname": "Ира", "group_id": "b0000000-0000-4000-8000-000000000072"}'),
  ('c0000000-0000-4000-8000-000000000073', 'g73-oleg@students.example.test',
   '{"login": "g73-oleg", "nickname": "Олег", "group_id": "b0000000-0000-4000-8000-000000000073"}');

-- ---------- миграция: оценки и настройки ----------
select is((select kie_credits from public.price_list
            where action = 'video' and model = 'bytedance/seedance-2-5' and tier = 'base'), 140::numeric,
  'оценка Seedance 2.5 — 140 кредитов за 5 с');
select is((select count(*)::int from public.price_list where kie_credits is null), 0, 'оценка есть у всего прайса');
select is((select value #>> '{}' from public.settings where key = 'staff_daily_credits'), '3000',
  'потолок ведущего по умолчанию — 3000 кредитов');
select is((select value #>> '{}' from public.settings where key = 'teacher_grant_max'), '1000',
  'начисление за раз — до 1000★');
select is((select value #>> '{}' from public.settings where key = 'teacher_grant_daily'), '5000',
  'начислений в сутки — до 5000★');

-- ---------- потолок кредитов ведущего ----------
set local role service_role;
select is((select balance from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
            'bytedance/seedance-2-5', 0, 'cap-t-00001', '{"duration": 10}')), 0, 'ведущий: видео 10 с');
select is((select kie_estimate from public.jobs where idempotency_key = 'cap-t-00001'), 280::numeric,
  'оценка 10 с — вдвое больше');
select job_id from public.create_job('a0000000-0000-4000-8000-000000000072', 'image', 'nano-banana-pro', 0,
  'cap-t-00002');
select is((select kie_estimate from public.jobs where idempotency_key = 'cap-t-00002'), 15::numeric,
  'оценка картинки');

reset role;
update public.settings set value = '500' where key = 'staff_daily_credits';
set local role service_role;
-- 280 + 15 + 140 = 435 ≤ 500
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
                   'bytedance/seedance-2-5', 0, 'cap-t-00003') $$, 'в пределах потолка');
-- 435 + 140 = 575 > 500
select throws_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
                    'bytedance/seedance-2-5', 0, 'cap-t-00004') $$, 'P0001', 'staff_daily_cap',
  'сверх потолка — staff_daily_cap');
select is((select count(*)::int from public.jobs where idempotency_key = 'cap-t-00004'), 0, 'задача не создана');
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'image',
                   'flux-3/klein-text-to-image', 0, 'cap-t-00005') $$, 'дешёвая задача ещё проходит (437)');
select is((select reused from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
            'bytedance/seedance-2-5', 0, 'cap-t-00003')), true, 'повтор того же ключа не упирается в потолок');
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'montage',
                   'platform/auto-montage', 0, 'cap-t-00006') $$, 'монтаж не считается');

-- неудачная задача не считается
select is((select refunded from public.refund_job((select id from public.jobs where idempotency_key = 'cap-t-00001'),
            'kie: fail')), 0, 'ведущему возвращать нечего');
-- 437 − 280 + 140 = 297
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
                   'bytedance/seedance-2-5', 0, 'cap-t-00007') $$, 'после неудачи место освободилось');

-- фактические кредиты шлюза важнее оценки
select ok(public.complete_job((select id from public.jobs where idempotency_key = 'cap-t-00007'),
  'x/y.mp4', '{}', 'video/mp4', null, 400), 'готово: шлюз насчитал 400');
select throws_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'image',
                    'flux-3/klein-text-to-image', 0, 'cap-t-00008') $$, 'P0001', 'staff_daily_cap',
  'считаются фактические кредиты (557)');

-- потолок у каждого свой; админ тоже ограничен
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000073', 'video',
                   'bytedance/seedance-2-5', 0, 'cap-u-00001') $$, 'у другого ведущего свой потолок');
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000071', 'video',
                   'bytedance/seedance-2-5', 0, 'cap-a-00001', '{"duration": 10}') $$, 'админ: 280');
select throws_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000071', 'video',
                    'bytedance/seedance-2-5', 0, 'cap-a-00002', '{"duration": 10}') $$, 'P0001', 'staff_daily_cap',
  'админ тоже ограничен: 280 + 280 > 500');

-- ученика потолок ведущих не касается
reset role;
update public.settings set value = '0' where key = 'staff_daily_credits';
set local role service_role;
select lives_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000072', 'video',
                   'bytedance/seedance-2-mini', 25, 'cap-s-00001') $$, 'ученик тратит звёзды как раньше');

-- null — без потолка
reset role;
update public.settings set value = 'null' where key = 'staff_daily_credits';
set local role service_role;
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000072', 'video',
                   'bytedance/seedance-2-5', 0, 'cap-t-00009') $$, 'null — без потолка');

-- рубильник «Стоп генераций»
reset role;
update public.settings set value = 'false' where key = 'generation_enabled';
set local role service_role;
select throws_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000071', 'image',
                    'flux-3/klein-text-to-image', 0, 'cap-a-00003') $$, 'P0001', 'generation_disabled',
  'стоп генераций касается и админа');
reset role;
update public.settings set value = 'true' where key = 'generation_enabled';
set local role service_role;

-- ---------- начисления ----------
select is(public.grant_stars('a0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072',
  1000, null, 'cap-g-00001'), 1075, 'ведущий начислил 1000 (100 − 25 + 1000)');
select throws_ok($$ select public.grant_stars('a0000000-0000-4000-8000-000000000072',
                    'c0000000-0000-4000-8000-000000000072', 1001) $$, 'P0001', 'grant_limit',
  'больше 1000 за раз нельзя');

reset role;
update public.settings set value = '1500' where key = 'teacher_grant_daily';
set local role service_role;
select throws_ok($$ select public.grant_stars('a0000000-0000-4000-8000-000000000072',
                    'c0000000-0000-4000-8000-000000000072', 600) $$, 'P0001', 'grant_limit',
  'сверх суточной суммы нельзя (1000 + 600 > 1500)');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', 500),
  1575, 'ровно до суточной суммы можно');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', -200),
  1375, 'снять можно и после лимита');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072',
  1000, null, 'cap-g-00001'), 1375, 'повтор старого ключа не упирается в лимит и не начисляет');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000073', 'c0000000-0000-4000-8000-000000000073', 1000),
  1100, 'у другого ведущего своя суточная сумма');

-- админ может превысить, это видно в аудите
select is(public.grant_stars('a0000000-0000-4000-8000-000000000071', 'c0000000-0000-4000-8000-000000000072', 5000),
  6375, 'админ начисляет больше лимита');
select is((select (meta ->> 'over_limit')::boolean from public.audit_log
            where action = 'stars.grant' and actor_id = 'a0000000-0000-4000-8000-000000000071'), true,
  'превышение помечено в аудите');
select is((select count(*)::int from public.audit_log
            where action = 'stars.grant' and actor_id = 'a0000000-0000-4000-8000-000000000072' and meta ? 'over_limit'),
  0, 'обычные начисления без пометки');

-- null — без лимита
reset role;
update public.settings set value = 'null' where key in ('teacher_grant_max', 'teacher_grant_daily');
set local role service_role;
select is(public.grant_stars('a0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', 5000),
  11375, 'null — без лимита (до общей границы 10 000)');
select throws_ok($$ select public.grant_stars('a0000000-0000-4000-8000-000000000072',
                    'c0000000-0000-4000-8000-000000000072', 10001) $$, 'P0001', 'bad_amount',
  'общая граница ±10 000 осталась');

-- функции по-прежнему только для сервера
reset role;
select ok(not has_function_privilege('authenticated',
  'public.grant_stars(uuid, uuid, integer, text, text)', 'execute'), 'клиент не вызывает grant_stars');

select * from finish();
rollback;
