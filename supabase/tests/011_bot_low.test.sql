-- Боты: счётчики страницы «Боты группы» одним запросом (аудит № 39) и лимиты открыток гостям
-- в одной транзакции с create_job (аудит № 45). Запуск: `supabase test db` или `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------- данные: ведущий, группа, ученики Ира и Олег со своими ботами ----------
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000111', 'teacher111@example.test');
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000111';
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000111', 'g111', 'Группа 111', 'a0000000-0000-4000-8000-000000000111', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000111', 'g111-ira@students.example.test',
   '{"login": "g111-ira", "nickname": "Ира", "group_id": "b0000000-0000-4000-8000-000000000111"}'),
  ('c0000000-0000-4000-8000-000000000112', 'g111-oleg@students.example.test',
   '{"login": "g111-oleg", "nickname": "Олег", "group_id": "b0000000-0000-4000-8000-000000000111"}');
update public.profiles set age_band = 'adult'
 where id in ('c0000000-0000-4000-8000-000000000111', 'c0000000-0000-4000-8000-000000000112');
insert into public.bots (id, owner_id, slug, name) values
  ('d0000000-0000-4000-8000-000000000111', 'c0000000-0000-4000-8000-000000000111', 'ira-bot', 'Бот Иры'),
  ('d0000000-0000-4000-8000-000000000112', 'c0000000-0000-4000-8000-000000000112', 'oleg-bot', 'Бот Олега');

-- Ира: 3 заявки; 4 сообщения гостей за неделю, 1 старое, 2 проверки владельцем, 2 ответа бота
insert into public.bot_leads (bot_id, channel, data) values
  ('d0000000-0000-4000-8000-000000000111', 'web', '{"Имя": "А"}'),
  ('d0000000-0000-4000-8000-000000000111', 'web', '{"Имя": "Б"}'),
  ('d0000000-0000-4000-8000-000000000111', 'telegram', '{"Имя": "В"}');
insert into public.bot_messages (bot_id, channel, conversation_id, role, content, created_at) values
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g1', 'user', 'привет', now()),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g1', 'user', 'ещё', now() - interval '1 day'),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g2', 'user', 'хай', now() - interval '6 days'),
  ('d0000000-0000-4000-8000-000000000111', 'telegram', 'tg:abc', 'user', 'тг', now()),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g3', 'user', 'старое', now() - interval '8 days'),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'owner:c0000000-0000-4000-8000-000000000111', 'user', 'проверка', now()),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'owner:c0000000-0000-4000-8000-000000000111', 'user', 'ещё', now()),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g1', 'assistant', 'ответ', now()),
  ('d0000000-0000-4000-8000-000000000111', 'web', 'web:g1', 'assistant', 'ответ', now());
-- Олег: 1 сообщение гостя, заявок нет
insert into public.bot_messages (bot_id, channel, conversation_id, role, content) values
  ('d0000000-0000-4000-8000-000000000112', 'web', 'web:g9', 'user', 'привет');

set local role service_role;

-- ---------- № 39: счётчики одним запросом ----------
select is((select leads_count from public.group_bot_counters(
            array['d0000000-0000-4000-8000-000000000111', 'd0000000-0000-4000-8000-000000000112']::uuid[],
            now() - interval '7 days') where bot_id = 'd0000000-0000-4000-8000-000000000111'), 3::bigint,
  'заявки Иры: 3');
select is((select guest_messages from public.group_bot_counters(
            array['d0000000-0000-4000-8000-000000000111', 'd0000000-0000-4000-8000-000000000112']::uuid[],
            now() - interval '7 days') where bot_id = 'd0000000-0000-4000-8000-000000000111'), 4::bigint,
  'сообщения гостей Иры за неделю: 4 (без старого, проверки владельцем и ответов бота)');
select is((select leads_count from public.group_bot_counters(
            array['d0000000-0000-4000-8000-000000000111', 'd0000000-0000-4000-8000-000000000112']::uuid[],
            now() - interval '7 days') where bot_id = 'd0000000-0000-4000-8000-000000000112'), 0::bigint,
  'у Олега заявок нет — строка с нулём');
select is((select guest_messages from public.group_bot_counters(
            array['d0000000-0000-4000-8000-000000000112']::uuid[], now() - interval '7 days')), 1::bigint,
  'сообщения гостей Олега: 1');
select is((select count(*)::int from public.group_bot_counters(
            array['d0000000-0000-4000-8000-000000000111', 'e0000000-0000-4000-8000-000000000999']::uuid[],
            now() - interval '7 days')), 1, 'несуществующий бот — без строки');
select is((select count(*)::int from public.group_bot_counters('{}'::uuid[], now())), 0, 'пустой список — пусто');
select throws_ok($$ select * from public.group_bot_counters(
                      array(select gen_random_uuid() from generate_series(1, 1001)), now()) $$,
  'P0001', 'too_many_bots', 'больше 1000 ботов за раз — отказ');

-- ---------- № 45: открытки гостям ----------
-- три открытки гостям за сутки — проходят (2★ каждая), Ира: 100 − 6 = 94
select is((select balance from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t1', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2)), 98, 'первая открытка гостю');
select is((select balance from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t2', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2)), 96, 'вторая открытка гостю');
select throws_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t3', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2) $$, 'P0001', 'too_many_jobs',
  'две открытки ещё в работе — третья ждёт (места владельца не заняты гостями)');
-- первая готова
reset role;
update public.jobs set status = 'done' where idempotency_key = 'card:test-t1';
set local role service_role;
select is((select balance from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t3', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2)), 94, 'третья открытка гостю');
reset role;
update public.jobs set status = 'done' where idempotency_key in ('card:test-t2', 'card:test-t3');
set local role service_role;
select throws_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t4', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2) $$, 'P0001', 'card_limit',
  'четвёртая за сутки — card_limit');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000111'), 94,
  'за отказ звёзды не списаны');
select is((select reused from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t2', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2)), true,
  'повтор того же билета после лимита — та же задача, без отказа');
select is((select count(*)::int from public.jobs where task_ref = 'bot-card:d0000000-0000-4000-8000-000000000111'), 3,
  'задач-открыток ровно 3');

-- открытки владельца в проверке (preview) в суточный лимит гостей не входят
select is((select reused from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-p1', '{"preview": true}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 99, 2)), false,
  'проверка владельцем считается отдельно от гостей');
-- открытки 25 часов назад в сутки не входят
reset role;
update public.jobs set created_at = now() - interval '25 hours', status = 'done'
 where task_ref = 'bot-card:d0000000-0000-4000-8000-000000000111';
set local role service_role;
select lives_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-t5', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2) $$, 'через сутки — снова можно');

-- ниже прайса ученику нельзя: проверки create_job действуют
select throws_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000112', 'image',
            'flux-3/klein-text-to-image', 1, 'card:test-o1', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000112', 3, 2) $$, 'P0001', 'forbidden',
  'цена ниже прайса — forbidden из create_job');
select throws_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000112', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-o2', '{"preview": false}', 'p', 'lesson-3', 3, 2) $$,
  'P0001', 'forbidden', 'task_ref не открытки — отказ');

-- ---------- доступ: только сервер ----------
reset role;
set local role authenticated;
select throws_ok($$ select * from public.group_bot_counters(array['d0000000-0000-4000-8000-000000000111']::uuid[], now()) $$,
  '42501', null, 'ученику счётчики недоступны');
select throws_ok($$ select * from public.create_bot_card_job('c0000000-0000-4000-8000-000000000111', 'image',
            'flux-3/klein-text-to-image', 2, 'card:test-x1', '{"preview": false}', 'p',
            'bot-card:d0000000-0000-4000-8000-000000000111', 3, 2) $$, '42501', null, 'ученику открытка напрямую недоступна');
reset role;
set local role anon;
select throws_ok($$ select * from public.group_bot_counters(array['d0000000-0000-4000-8000-000000000111']::uuid[], now()) $$,
  '42501', null, 'гостю счётчики недоступны');

select * from finish();
rollback;
