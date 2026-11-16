-- Личные данные (миграция 20261116190000_privacy): колонки groups для клиентов, общая галерея
-- не через RLS, поля согласия, сроки хранения гостевых данных ботов, удаление ученика админом,
-- блокировка группы только при включённом дневном лимите.
-- Запуск: `supabase test db` или `scripts/db-test/run.sh`. Имена и логины выдуманы.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- ---------- данные: админ, ведущий, группа 91 (кончилась 40 дней назад), группа 92 (10 дней назад) ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000091', 'admin91@example.test'),
  ('a0000000-0000-4000-8000-000000000092', 'teacher92@example.test');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000091';
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000092';
insert into public.groups (id, code, title, teacher_id, stars_per_student, ends_on, share_gallery, budget_stars) values
  ('b0000000-0000-4000-8000-000000000091', 'g91', 'Группа 91', 'a0000000-0000-4000-8000-000000000092', 100,
   (now() at time zone 'Europe/Berlin')::date - 40, true, 5000),
  ('b0000000-0000-4000-8000-000000000092', 'g92', 'Группа 92', 'a0000000-0000-4000-8000-000000000092', 100,
   (now() at time zone 'Europe/Berlin')::date - 10, false, 5000);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000911', 'g91-tova@students.example.test',
   '{"login": "g91-tova", "nickname": "Това", "group_id": "b0000000-0000-4000-8000-000000000091", "created_by": "a0000000-0000-4000-8000-000000000092"}'),
  ('c0000000-0000-4000-8000-000000000912', 'g91-zeev@students.example.test',
   '{"login": "g91-zeev", "nickname": "Зеэв", "group_id": "b0000000-0000-4000-8000-000000000091", "created_by": "a0000000-0000-4000-8000-000000000092"}'),
  ('c0000000-0000-4000-8000-000000000921', 'g92-mira@students.example.test',
   '{"login": "g92-mira", "nickname": "Мира", "group_id": "b0000000-0000-4000-8000-000000000092", "created_by": "a0000000-0000-4000-8000-000000000092"}');

-- боты: у Товы, Зеэва, Миры и у ведущего (бот ведущего без срока)
insert into public.bots (id, owner_id, slug, name) values
  ('d0000000-0000-4000-8000-000000000911', 'c0000000-0000-4000-8000-000000000911', 'tova-latke', 'Латке Товы'),
  ('d0000000-0000-4000-8000-000000000912', 'c0000000-0000-4000-8000-000000000912', 'zeev-bot', 'Бот Зеэва'),
  ('d0000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000921', 'mira-bot', 'Бот Миры'),
  ('d0000000-0000-4000-8000-000000000929', 'a0000000-0000-4000-8000-000000000092', 'teacher-bot', 'Бот ведущего');

-- переписка: 3 старых сообщения гостей у Зеэва, 1 старое у ведущего, 1 старая проверка владельцем,
-- свежие сообщения гостя у Зеэва и у Товы
insert into public.bot_messages (bot_id, channel, conversation_id, role, content, created_at) values
  ('d0000000-0000-4000-8000-000000000912', 'web', 'web:guest-old-1', 'user', 'привет', now() - interval '40 days'),
  ('d0000000-0000-4000-8000-000000000912', 'web', 'web:guest-old-1', 'assistant', 'здравствуйте', now() - interval '40 days'),
  ('d0000000-0000-4000-8000-000000000912', 'telegram', 'tg:old-chat', 'user', 'старое', now() - interval '31 days'),
  ('d0000000-0000-4000-8000-000000000929', 'web', 'web:guest-old-2', 'user', 'старое у ведущего', now() - interval '35 days'),
  ('d0000000-0000-4000-8000-000000000912', 'web', 'owner:c0000000-0000-4000-8000-000000000912', 'user', 'проверка',
   now() - interval '60 days'),
  ('d0000000-0000-4000-8000-000000000912', 'web', 'web:guest-new', 'user', 'новое', now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000911', 'web', 'web:guest-tova', 'user', 'гость Товы', now() - interval '1 day');

-- заявки: у Зеэва (группа кончилась 40 дней назад) — удаляются; у Миры (10 дней) и у ведущего — остаются.
-- Заявка Товы добавляется после чистки и уходит вместе с её данными.
insert into public.bot_leads (bot_id, channel, data, created_at) values
  ('d0000000-0000-4000-8000-000000000912', 'web', '{"Имя": "Гость Один"}', now() - interval '45 days'),
  ('d0000000-0000-4000-8000-000000000912', 'web', '{"Имя": "Гость Два"}', now() - interval '41 days'),
  ('d0000000-0000-4000-8000-000000000921', 'web', '{"Имя": "Гость Три"}', now() - interval '20 days'),
  ('d0000000-0000-4000-8000-000000000929', 'web', '{"Имя": "Гость Четыре"}', now() - interval '90 days');

insert into public.homework_submissions (user_id, group_id, lesson_id, kind, text_body, status) values
  ('c0000000-0000-4000-8000-000000000911', 'b0000000-0000-4000-8000-000000000091', 'lesson-1', 'text', 'моя домашка', 'submitted');

insert into public.audit_log (actor_id, action, target_group, meta) values
  ('a0000000-0000-4000-8000-000000000092', 'students.create', 'b0000000-0000-4000-8000-000000000091',
   '{"count": 2, "logins": ["g91-tova", "g91-zeev"]}');
insert into public.audit_log (actor_id, action, target_user, target_group, meta) values
  ('c0000000-0000-4000-8000-000000000911', 'bot.create', 'c0000000-0000-4000-8000-000000000911',
   'b0000000-0000-4000-8000-000000000091', '{"bot": "d0000000-0000-4000-8000-000000000911", "slug": "tova-latke"}');

-- ---------- № 38: лимит дня и пауза работают как раньше (блокировка строки группы — только при лимите;
-- одной сессией её не проверить, см. тело private.lock_for_spend) ----------
set local role service_role;
select is((select reused from public.create_job('c0000000-0000-4000-8000-000000000911', 'image',
            'flux-3/klein-text-to-image', 2, 'priv-job-0001')), false, 'Това: картинка за 2★ (лимит дня выключен)');
reset role;
update public.groups set daily_cap = 1000 where id = 'b0000000-0000-4000-8000-000000000092';
set local role service_role;
select is((select reused from public.create_job('c0000000-0000-4000-8000-000000000921', 'image',
            'flux-3/klein-text-to-image', 2, 'priv-job-0002')), false, 'Мира: картинка при лимите дня 1000★');
reset role;
update public.groups set daily_cap = 3 where id = 'b0000000-0000-4000-8000-000000000092';
set local role service_role;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000921', 'image',
                    'flux-3/klein-text-to-image', 2, 'priv-job-0003') $$, 'P0001', 'daily_cap',
  'лимит дня по-прежнему действует');
reset role;
update public.groups set daily_cap = 1000000, paused = true where id = 'b0000000-0000-4000-8000-000000000092';
set local role service_role;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000921', 'image',
                    'flux-3/klein-text-to-image', 2, 'priv-job-0004') $$, 'P0001', 'group_paused',
  'пауза группы без лимита дня по-прежнему действует');
reset role;
update public.groups set paused = false where id = 'b0000000-0000-4000-8000-000000000092';
update public.jobs set status = 'done', storage_path = 'c0000000-0000-4000-8000-000000000911/x.png'
 where idempotency_key = 'priv-job-0001';

-- ---------- № 57: колонки groups и общая галерея для ученика ----------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000912", "role": "authenticated"}';
select is((select count(*)::int from public.groups), 1, 'ученик видит свою группу (встраивание в профиль работает)');
select lives_ok($$ select id, code, title, paused, ends_on, allow_google_minors, share_gallery from public.groups $$,
  'нужные приложению колонки группы читаются');
select lives_ok($$ select p.id, g.code, g.share_gallery from public.profiles p
                    join public.groups g on g.id = p.group_id $$, 'профиль с группой читается');
select throws_ok($$ select budget_stars from public.groups $$, '42501', null, 'ученик не видит бюджет группы');
select throws_ok($$ select stars_per_student, planned_students from public.groups $$, '42501', null,
  'ученик не видит «каждому» и план учеников');
select throws_ok($$ select teacher_id from public.groups $$, '42501', null, 'ученик не видит teacher_id');
select throws_ok($$ select daily_cap from public.groups $$, '42501', null, 'ученик не видит дневной лимит');
select throws_ok($$ select * from public.groups $$, '42501', null, 'вся строка группы ученику недоступна');
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-000000000911'), 0,
  'общая галерея включена, но строки одногруппника через Data API не видны');

set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000092", "role": "authenticated"}';
select is((select count(*)::int from public.groups), 2, 'ведущий по-прежнему видит свои группы (политика не менялась)');
select is((select count(*)::int from public.jobs where group_id = 'b0000000-0000-4000-8000-000000000091'), 1,
  'ведущий видит задачи учеников своей группы');
reset role;

-- ---------- № 25: способ и кто отметил согласие ----------
select throws_ok($$ update public.profiles set parental_consent_method = 'paper_centre'
                    where id = 'c0000000-0000-4000-8000-000000000912' $$, '23514', null,
  'способ согласия без отметки согласия не пишется');
select throws_ok($$ update public.profiles set parental_consent_at = now(), parental_consent_method = 'scan_of_passport'
                    where id = 'c0000000-0000-4000-8000-000000000912' $$, '23514', null,
  'только способы из списка (без документов и данных родителей)');
select lives_ok($$ update public.profiles set parental_consent_at = now(), parental_consent_method = 'paper_centre',
                    parental_consent_by = 'a0000000-0000-4000-8000-000000000092'
                    where id = 'c0000000-0000-4000-8000-000000000912' $$, 'согласие: дата, способ и кто отметил');
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000912", "role": "authenticated"}';
select throws_ok($$ update public.profiles set parental_consent_method = 'electronic_centre' where id = auth.uid() $$,
  '42501', null, 'ученик не отмечает согласие себе сам');
reset role;

-- ---------- № 23: сроки хранения гостевых данных ботов ----------
set local role authenticated;
select throws_ok($$ select * from public.sweep_bot_guest_data() $$, '42501', null, 'чистку зовёт только сервер');
reset role;
set local role service_role;
select throws_ok($$ select * from public.sweep_bot_guest_data(1, 30, 100) $$, 'P0001', 'bad_input',
  'срок меньше 7 дней не принимается');
select throws_ok($$ select * from public.sweep_bot_guest_data(30, 30, 100000) $$, 'P0001', 'bad_input',
  'больше 5000 строк за вызов не принимается');
select is((select row(messages, leads)::text from public.sweep_bot_guest_data(30, 30, 1)), '(1,1)',
  'за вызов — не больше p_limit строк каждой таблицы');
select is((select row(messages, leads)::text from public.sweep_bot_guest_data(30, 30, 5000)), '(3,1)',
  'удалены остальные: всего 4 старых сообщения гостей и 2 заявки бота группы, кончившейся 40 дней назад');
select is((select row(messages, leads)::text from public.sweep_bot_guest_data(30, 30, 5000)), '(0,0)',
  'повторный вызов ничего не удаляет');
reset role;
select is((select count(*)::int from public.bot_messages where conversation_id like 'owner:%'), 1,
  'проверка владельцем не удаляется');
select is((select count(*)::int from public.bot_messages where conversation_id in ('web:guest-new', 'web:guest-tova')), 2,
  'свежая переписка гостей остаётся');
select is((select count(*)::int from public.bot_leads where bot_id = 'd0000000-0000-4000-8000-000000000921'), 1,
  'заявки группы, кончившейся 10 дней назад, остаются');
select is((select count(*)::int from public.bot_leads where bot_id = 'd0000000-0000-4000-8000-000000000929'), 1,
  'заявки бота ведущего автоматически не удаляются');

-- ---------- № 23: удалить ученика (только админ) ----------
insert into public.bot_leads (bot_id, channel, data) values
  ('d0000000-0000-4000-8000-000000000911', 'web', '{"Имя": "Гость Пять"}');
set local role authenticated;
select throws_ok($$ select * from public.delete_student_data('a0000000-0000-4000-8000-000000000091',
                    'c0000000-0000-4000-8000-000000000911') $$, '42501', null, 'клиент не вызывает удаление');
reset role;
set local role service_role;
select throws_ok($$ select * from public.delete_student_data('a0000000-0000-4000-8000-000000000092',
                    'c0000000-0000-4000-8000-000000000911') $$, 'P0001', 'forbidden', 'ведущий не удаляет данные ученика');
select throws_ok($$ select * from public.delete_student_data('a0000000-0000-4000-8000-000000000091',
                    'a0000000-0000-4000-8000-000000000092') $$, 'P0001', 'forbidden', 'аккаунт ведущего так не удалить');
select throws_ok($$ select * from public.delete_student_data('a0000000-0000-4000-8000-000000000091',
                    'c0000000-0000-4000-8000-000000000999') $$, 'P0001', 'user_not_found', 'нет такого ученика');
select is((select row(jobs, homework, bot_messages, bot_leads, auth_deleted)::text
             from public.delete_student_data('a0000000-0000-4000-8000-000000000091',
                                             'c0000000-0000-4000-8000-000000000911', 3)),
  '(1,1,1,1,t)', 'админ удалил Тову: задача, домашка, переписка и заявка её бота, вход');
reset role;
select is((select count(*)::int from auth.users where id = 'c0000000-0000-4000-8000-000000000911'), 0, 'входа больше нет');
select is((select count(*)::int from public.profiles where id = 'c0000000-0000-4000-8000-000000000911'), 0, 'профиля нет');
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-000000000911'), 0, 'задач нет');
select is((select count(*)::int from public.star_ledger where user_id = 'c0000000-0000-4000-8000-000000000911'), 0,
  'журнал звёзд ученика удалён вместе с задачами (ссылки журнала на задачи не мешают)');
select is((select count(*)::int from public.homework_submissions where user_id = 'c0000000-0000-4000-8000-000000000911'), 0,
  'домашек нет');
select is((select count(*)::int from public.bots where owner_id = 'c0000000-0000-4000-8000-000000000911'), 0,
  'бота нет (переписка и заявки — каскадом)');
select is((select count(*)::int from public.audit_log where action = 'student.data_delete' and target_user is null
             and target_group = 'b0000000-0000-4000-8000-000000000091'
             and meta = '{"jobs": 1, "files": 3, "ledger": 2, "homework": 1, "bot_leads": 1, "bot_messages": 1}'::jsonb), 1,
  'в журнале — одна строка удаления только со счётчиками');
select is((select count(*)::int from public.audit_log
            where meta::text like '%g91-tova%' or meta::text like '%tova-latke%'
               or target_user = 'c0000000-0000-4000-8000-000000000911'
               or actor_id = 'c0000000-0000-4000-8000-000000000911'), 0,
  'логин, адрес бота и id ученика вычищены из журнала');
select is((select meta -> 'logins' from public.audit_log where action = 'students.create'
            and target_group = 'b0000000-0000-4000-8000-000000000091'), '["g91-zeev"]'::jsonb,
  'логин одногруппника в записи о создании пачки остался');
select is((select count(*)::int from public.profiles where id = 'c0000000-0000-4000-8000-000000000912'), 1,
  'одногруппник не тронут');
select is((select count(*)::int from public.wallets w
            where w.balance <> coalesce((select sum(l.delta) from public.star_ledger l where l.user_id = w.user_id), 0)), 0,
  'у остальных баланс по-прежнему равен сумме журнала');

select * from finish();
rollback;
