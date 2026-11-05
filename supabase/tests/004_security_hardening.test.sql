-- Аудит безопасности: атомарные лимиты сообщений ботов и счётчики попыток входа.
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------- данные: учитель, группа, ученица с ботом ----------
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000041', 'teacher41@example.test');
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000041';
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000041', 'g41', 'Группа 41', 'a0000000-0000-4000-8000-000000000041', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000041', 'g41-lena@students.example.test',
   '{"login": "g41-lena", "nickname": "Лена", "group_id": "b0000000-0000-4000-8000-000000000041"}');
insert into public.bots (id, owner_id, slug, name) values
  ('d0000000-0000-4000-8000-000000000041', 'c0000000-0000-4000-8000-000000000041', 'lena-bot', 'Бот Лены'),
  ('d0000000-0000-4000-8000-000000000042', 'a0000000-0000-4000-8000-000000000041', 'teacher-bot', 'Бот ведущего');

set local role service_role;

-- ---------- лимит с одного IP: 2 в час (на все боты) ----------
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s1', 'user',
            'привет', 'ip-hash-1', null, 0, 'bot:41:msg-0001', 2, 100)), 'accepted', 'первое сообщение гостя принято');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000042', 'web', 'web:s1', 'user',
            'привет', 'ip-hash-1', null, 0, 'bot:42:msg-0002', 2, 100)), 'accepted', 'второе (другой бот) принято');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s1', 'user',
            'ещё', 'ip-hash-1', null, 0, 'bot:41:msg-0003', 2, 100)), 'sender_hour',
  'третье с того же IP за час — лимит отправителя');
select is((select count(*)::int from public.bot_messages where ip_hash = 'ip-hash-1'), 2,
  'сообщение сверх лимита не записано');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s2', 'user',
            'привет', 'ip-hash-2', null, 0, 'bot:41:msg-0004', 2, 100)), 'accepted', 'другой IP не задет');

-- ---------- повтор того же сообщения ----------
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s2', 'user',
            'привет', 'ip-hash-2', null, 0, 'bot:41:msg-0004', 2, 100)), 'duplicate', 'тот же ключ — повтор');
select is((select count(*)::int from public.bot_messages where dedupe_key = 'bot:41:msg-0004'), 1,
  'повтор не записан второй раз');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'telegram', 'tg:x', 'user',
            'привет', 'tg-hash-1', 555, 0, 'tg:41:update-555', 30, 100)), 'accepted', 'обновление Telegram принято');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'telegram', 'tg:x', 'user',
            'привет', 'tg-hash-1', 555, 0, null, 30, 100)), 'duplicate', 'тот же update_id — повтор');

-- ---------- лимит бота в сутки: 4 (сейчас у бота Лены 3 сообщения гостей) ----------
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'owner:lena', 'user',
            'проверка', null, null, 0, 'bot:41:msg-0005', null, null)), 'accepted', 'проверка владельцем без лимитов');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s3', 'user',
            'привет', 'ip-hash-3', null, 0, 'bot:41:msg-0006', 30, 4)), 'accepted',
  'четвёртое сообщение гостя за сутки принято (проверка владельцем не считается)');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s4', 'user',
            'привет', 'ip-hash-4', null, 0, 'bot:41:msg-0007', 30, 4)), 'bot_day', 'пятое — лимит бота');
select is((select outcome from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:s3', 'assistant',
            'ответ', null, null, 1, null, null, null)), 'accepted', 'ответ бота пишется без лимитов');

-- ---------- счётчики попыток входа ----------
select is(public.rate_limit_hit('login:test-key-0001', 2, 600), true, 'первая попытка');
select is(public.rate_limit_hit('login:test-key-0001', 2, 600), true, 'вторая попытка');
select is(public.rate_limit_hit('login:test-key-0001', 2, 600), false, 'третья — лимит');
select is(public.rate_limit_hit('login:test-key-0002', 2, 600), true, 'другой ключ не задет');
select lives_ok($$ select public.rate_limit_reset('login:test-key-0001') $$, 'сброс счётчика');
select is(public.rate_limit_hit('login:test-key-0001', 2, 600), true, 'после сброса попытки снова есть');
select throws_ok($$ select public.rate_limit_hit('short', 2, 600) $$, 'P0001', 'bad_rate_limit', 'короткий ключ отклонён');

-- ---------- ученик без группы (самостоятельная регистрация) ничего не тратит ----------
reset role;
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-000000000049', 'selfsignup@example.test');
-- даже если звёзды как-то появились (например, бонус за тест)
select public.record_quiz_attempt('c0000000-0000-4000-8000-000000000049', 'lesson-1', '[]', 10, 10, 20);
set local role service_role;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000049', 'image',
                    'flux-3/klein-text-to-image', 2, 'nogroup-0001') $$, 'P0001', 'forbidden',
  'ученик без группы не запускает генерации');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000049', 'montage',
                    'platform/auto-montage', 0, 'nogroup-0002') $$, 'P0001', 'forbidden',
  'и бесплатный монтаж тоже');
select throws_ok($$ select * from public.spend_stars('c0000000-0000-4000-8000-000000000049', 1, 'bot_reply',
                    'bot:nogroup-0003') $$, 'P0001', 'forbidden', 'и ответы бота за его звёзды');
select lives_ok($$ select * from public.create_job('a0000000-0000-4000-8000-000000000041', 'video',
                    'bytedance/seedance-2-5', 0, 'teacher-free-0001') $$, 'ведущий без группы генерирует как раньше');

-- ---------- клиенты ничего из этого не вызывают ----------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000041", "role": "authenticated"}';
select throws_ok($$ select * from public.insert_bot_message('d0000000-0000-4000-8000-000000000041', 'web', 'web:x',
                    'user', 'x', null, null, 0, null, null, null) $$, '42501', null,
  'клиент не пишет сообщения бота сам');
select throws_ok($$ select public.rate_limit_reset('login:test-key-0001') $$, '42501', null,
  'клиент не сбрасывает счётчики попыток');
select throws_ok($$ select * from private.rate_limit_hits $$, '42501', null, 'таблица попыток клиенту недоступна');

select * from finish();
rollback;
