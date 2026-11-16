-- Кабинет ведущего: суммы звёзд и отчёт в SQL (больше 1000 строк журнала), отключение ученика,
-- начисление всей группе с лимитами ведущего. Запуск: `supabase test db` или `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- ---------- данные: админ, два ведущих, три ученика в группе 82 и один в группе 83 ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000081', 'admin81@example.test'),
  ('a0000000-0000-4000-8000-000000000082', 'teacher82@example.test'),
  ('a0000000-0000-4000-8000-000000000083', 'teacher83@example.test');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000081';
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000082', 'a0000000-0000-4000-8000-000000000083');
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000082', 'g82', 'Группа 82', 'a0000000-0000-4000-8000-000000000082', 100),
  ('b0000000-0000-4000-8000-000000000083', 'g83', 'Группа 83', 'a0000000-0000-4000-8000-000000000083', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000821', 'g82-ann@students.example.test',
   '{"login": "g82-ann", "nickname": "Аня", "group_id": "b0000000-0000-4000-8000-000000000082"}'),
  ('c0000000-0000-4000-8000-000000000822', 'g82-bob@students.example.test',
   '{"login": "g82-bob", "nickname": "Боря", "group_id": "b0000000-0000-4000-8000-000000000082"}'),
  ('c0000000-0000-4000-8000-000000000823', 'g82-cat@students.example.test',
   '{"login": "g82-cat", "nickname": "Катя", "group_id": "b0000000-0000-4000-8000-000000000082"}'),
  ('c0000000-0000-4000-8000-000000000831', 'g83-dan@students.example.test',
   '{"login": "g83-dan", "nickname": "Даня", "group_id": "b0000000-0000-4000-8000-000000000083"}');

-- Журнал больше 1000 строк (столько PostgREST отдаёт за запрос): 1200 списаний и 50 возвратов у Ани,
-- 30 ответов бота сегодня и 10 списаний по 5★ три дня назад у Бори, бонус за тест у Кати,
-- списание у ученика другой группы. Пишем напрямую (как postgres): здесь проверяются только суммы.
insert into public.star_ledger (user_id, delta, reason, balance_after)
select 'c0000000-0000-4000-8000-000000000821', -1, 'debit', 0 from generate_series(1, 1200);
insert into public.star_ledger (user_id, delta, reason, balance_after)
select 'c0000000-0000-4000-8000-000000000821', 1, 'refund', 0 from generate_series(1, 50);
insert into public.star_ledger (user_id, delta, reason, balance_after)
select 'c0000000-0000-4000-8000-000000000822', -1, 'bot_reply', 0 from generate_series(1, 30);
insert into public.star_ledger (user_id, delta, reason, balance_after, created_at)
select 'c0000000-0000-4000-8000-000000000822', -5, 'debit', 0, now() - interval '3 days' from generate_series(1, 10);
insert into public.star_ledger (user_id, delta, reason, balance_after, ref)
values ('c0000000-0000-4000-8000-000000000823', 20, 'quiz_bonus', 120, 'lesson-1');
insert into public.star_ledger (user_id, delta, reason, balance_after)
values ('c0000000-0000-4000-8000-000000000831', -7, 'debit', 93);

insert into public.lesson_progress (user_id, lesson_id, step) values
  ('c0000000-0000-4000-8000-000000000821', 'lesson-1', 'theory'),
  ('c0000000-0000-4000-8000-000000000821', 'lesson-1', 'old-task'),
  ('c0000000-0000-4000-8000-000000000821', 'lesson-2', 'quiz'),
  ('c0000000-0000-4000-8000-000000000822', 'lesson-1', 'theory'),
  ('c0000000-0000-4000-8000-000000000822', 'lesson-1', 'task-1'),
  ('c0000000-0000-4000-8000-000000000831', 'lesson-1', 'theory');

insert into auth.sessions (user_id) values
  ('c0000000-0000-4000-8000-000000000822'), ('c0000000-0000-4000-8000-000000000822'),
  ('c0000000-0000-4000-8000-000000000821');

set local role service_role;

-- ---------- № 14: звёзды группы ----------
select is(public.grant_stars('a0000000-0000-4000-8000-000000000082', 'c0000000-0000-4000-8000-000000000822', 50,
  null, 'agg-grant-0001'), 150, 'ведущий начислил Боре 50');
-- given: 300 стартовых + 20 бонус + 50; handed: без бонуса; spent: 1200 − 50 + 30 + 50
select is((select given from public.group_star_stats('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082')), 370::bigint, 'роздано — по всему журналу');
select is((select handed from public.group_star_stats('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082')), 350::bigint, 'стартовые и ручные — без бонусов тестов');
select is((select spent from public.group_star_stats('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082')), 1230::bigint, 'потрачено — все 1290 строк трат, не первые 1000');
select is((select spent from public.group_star_stats('a0000000-0000-4000-8000-000000000081',
            'b0000000-0000-4000-8000-000000000082')), 1230::bigint, 'админ видит то же');
select is((select spent from public.group_star_stats('a0000000-0000-4000-8000-000000000083',
            'b0000000-0000-4000-8000-000000000083')), 7::bigint, 'другая группа считается отдельно');
select throws_ok($$ select * from public.group_star_stats('a0000000-0000-4000-8000-000000000083',
                    'b0000000-0000-4000-8000-000000000082') $$, 'P0001', 'forbidden', 'чужая группа — forbidden');
select throws_ok($$ select * from public.group_star_stats('c0000000-0000-4000-8000-000000000821',
                    'b0000000-0000-4000-8000-000000000082') $$, 'P0001', 'forbidden', 'ученику — forbidden');
select throws_ok($$ select * from public.group_star_stats('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000099') $$, 'P0001', 'forbidden', 'нет такой группы — forbidden');

-- ---------- № 15: траты и прогресс по ученику ----------
select is((select spent_total from public.group_report_spending('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082') where user_id = 'c0000000-0000-4000-8000-000000000821'),
  1150::bigint, 'Аня: потрачено всего');
select is((select generations || '/' || refunds from public.group_report_spending('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082') where user_id = 'c0000000-0000-4000-8000-000000000821'),
  '1200/50', 'Аня: генераций и возвратов');
select is((select spent_total || '/' || spent_today || '/' || bot_replies
             from public.group_report_spending('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082') where user_id = 'c0000000-0000-4000-8000-000000000822'),
  '80/30/30', 'Боря: всего, сегодня (по Берлину) и ответов бота');
select is((select count(*)::int from public.group_report_spending('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082')), 2, 'строки только у тех, кто тратил, и только своей группы');
select throws_ok($$ select * from public.group_report_spending('a0000000-0000-4000-8000-000000000083',
                    'b0000000-0000-4000-8000-000000000082') $$, 'P0001', 'forbidden', 'траты чужой группы — forbidden');

select is((select steps from public.group_report_progress('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', array['lesson-1', 'lesson-1', 'lesson-2'],
            array['theory', 'task-1', 'quiz'])
          where user_id = 'c0000000-0000-4000-8000-000000000821' and lesson_id = 'lesson-1'),
  1, 'старый id задания не считается');
select is((select steps from public.group_report_progress('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', array['lesson-1', 'lesson-1', 'lesson-2'],
            array['theory', 'task-1', 'quiz'])
          where user_id = 'c0000000-0000-4000-8000-000000000822' and lesson_id = 'lesson-1'),
  2, 'Боря: два шага урока 1');
select is((select count(*)::int from public.group_report_progress('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', array['lesson-1', 'lesson-1', 'lesson-2'],
            array['theory', 'task-1', 'quiz'])), 3, 'три пары ученик-урок, ученик другой группы не попал');
select throws_ok($$ select * from public.group_report_progress('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', array['lesson-1'], array['theory', 'quiz']) $$,
  'P0001', 'bad_input', 'массивы разной длины — bad_input');
select throws_ok($$ select * from public.group_report_progress('a0000000-0000-4000-8000-000000000083',
                    'b0000000-0000-4000-8000-000000000082', array['lesson-1'], array['theory']) $$,
  'P0001', 'forbidden', 'прогресс чужой группы — forbidden');

-- ---------- № 26: отключить и включить ученика ----------
select is(public.set_student_disabled('a0000000-0000-4000-8000-000000000082', 'c0000000-0000-4000-8000-000000000822',
  true), true, 'ведущий отключил Борю');
select is((select disabled from public.profiles where id = 'c0000000-0000-4000-8000-000000000822'), true,
  'флаг disabled поставлен');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'c0000000-0000-4000-8000-000000000822'), 0,
  'сессии Бори закрыты');
select is((select count(*)::int from auth.sessions where user_id = 'c0000000-0000-4000-8000-000000000821'), 1,
  'чужие сессии не тронуты');
set local role service_role;
select is((select (meta ->> 'sessions')::int from public.audit_log
            where action = 'student.disable' and target_user = 'c0000000-0000-4000-8000-000000000822'), 2,
  'в аудите: student.disable и число закрытых сессий');
select is(public.set_student_disabled('a0000000-0000-4000-8000-000000000082', 'c0000000-0000-4000-8000-000000000822',
  true), false, 'повтор ничего не меняет');
select is((select count(*)::int from public.audit_log where action = 'student.disable'), 1, 'повтор не пишет аудит');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-000000000822', 'text',
                    'claude-haiku-5-5', 1, 'agg-job-00001') $$, 'P0001', 'user_disabled',
  'отключённый не тратит звёзды');
select throws_ok($$ select public.set_student_disabled('a0000000-0000-4000-8000-000000000083',
                    'c0000000-0000-4000-8000-000000000821', true) $$, 'P0001', 'forbidden',
  'ученика чужой группы — forbidden');
select throws_ok($$ select public.set_student_disabled('a0000000-0000-4000-8000-000000000081',
                    'a0000000-0000-4000-8000-000000000082', true) $$, 'P0001', 'forbidden',
  'ведущего так не отключить');
select throws_ok($$ select public.set_student_disabled('a0000000-0000-4000-8000-000000000082',
                    'c0000000-0000-4000-8000-000000000999', true) $$, 'P0001', 'user_not_found', 'нет ученика');
select is(public.set_student_disabled('a0000000-0000-4000-8000-000000000081', 'c0000000-0000-4000-8000-000000000822',
  false), true, 'админ включил Борю');
select is((select disabled from public.profiles where id = 'c0000000-0000-4000-8000-000000000822'), false,
  'Боря снова активен');
select is((select count(*)::int from public.audit_log where action = 'student.enable'), 1, 'в аудите student.enable');

-- отключённый ведущий ничего не может
reset role;
update public.profiles set disabled = true where id = 'a0000000-0000-4000-8000-000000000083';
set local role service_role;
select throws_ok($$ select * from public.group_star_stats('a0000000-0000-4000-8000-000000000083',
                    'b0000000-0000-4000-8000-000000000083') $$, 'P0001', 'forbidden', 'отключённый ведущий — forbidden');
reset role;
update public.profiles set disabled = false where id = 'a0000000-0000-4000-8000-000000000083';
set local role service_role;

-- ---------- № 27: начисление всей группе ----------
select public.set_student_disabled('a0000000-0000-4000-8000-000000000082', 'c0000000-0000-4000-8000-000000000823', true);
-- балансы до: Аня 100, Боря 150, Катя (отключена) 100
select is((select affected || '/' || skipped || '/' || total || '/' || already
             from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                  'b0000000-0000-4000-8000-000000000082', 100, 'add', 'урок 2', 'grp-key-000001')),
  '2/0/200/false', 'всем по 100: двум активным');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000821'), 200, 'Аня: 200');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000822'), 250, 'Боря: 250');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000823'), 100,
  'отключённой Кате не начислено');
select is((select already from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', 100, 'add', 'урок 2', 'grp-key-000001')), true,
  'повтор той же формы — уже сделано');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000821'), 200,
  'повтор не начислил второй раз');
select is((select count(*)::int from public.star_ledger
            where user_id = 'c0000000-0000-4000-8000-000000000821' and reason = 'grant'), 1,
  'в журнале Ани одна строка начисления');
select is((select count(*)::int from public.audit_log where action = 'stars.grant_group'), 1,
  'в аудите одна запись stars.grant_group');

select is((select affected || '/' || total from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', -220, 'add', null, 'grp-key-000002')),
  '2/-420', 'снять 220: у Ани только 200 (до нуля), у Бори 220');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000821'), 0,
  'Аня на нуле, не в минусе');
select is((select affected || '/' || skipped from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', -10, 'add', null, 'grp-key-000003')),
  '1/1', 'снять 10: у Ани нечего (пропуск), у Бори 30 → 20');
select is((select affected || '/' || total from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', 120, 'top_up_to', null, 'grp-key-000004')),
  '2/220', 'довести до 120: Ане +120, Боре +100');
select is((select skipped from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
            'b0000000-0000-4000-8000-000000000082', 100, 'top_up_to', null, 'grp-key-000005')),
  2, 'у кого уже больше — пропуск');

-- лимиты ведущего из grant_stars: пачка целиком или никому
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', 1001, 'add', null, 'grp-key-000006') $$,
  'P0001', 'grant_limit', 'больше 1000 каждому за раз — grant_limit');
reset role;
-- за сегодня ведущий начислил 50 + 200 + 220 = 470
update public.settings set value = '600' where key = 'teacher_grant_daily';
set local role service_role;
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', 100, 'add', null, 'grp-key-000007') $$,
  'P0001', 'grant_limit', 'сверх суточной суммы (470 + 200 > 600) — grant_limit');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-000000000821'), 120,
  'при отказе не начислено никому (Аня — первая в очереди)');
select is((select count(*)::int from public.star_ledger
            where idempotency_key = 'grp:' || md5('grp-key-000007:c0000000-0000-4000-8000-000000000821')), 0,
  'строк журнала от отказанной пачки нет');
select is((select affected from public.grant_stars_group('a0000000-0000-4000-8000-000000000081',
            'b0000000-0000-4000-8000-000000000082', 2000, 'add', null, 'grp-key-000008')),
  2, 'админ может больше лимита ведущего');
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000083',
                    'b0000000-0000-4000-8000-000000000082', 10, 'add', null, 'grp-key-000009') $$,
  'P0001', 'forbidden', 'чужой группе — forbidden');
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', 10, 'all', null, 'grp-key-000010') $$,
  'P0001', 'bad_input', 'неизвестный режим — bad_input');
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', -10, 'top_up_to', null, 'grp-key-000011') $$,
  'P0001', 'bad_amount', '«довести до» минуса — bad_amount');
select throws_ok($$ select * from public.grant_stars_group('a0000000-0000-4000-8000-000000000082',
                    'b0000000-0000-4000-8000-000000000082', 10, 'add', null, 'short') $$,
  'P0001', 'bad_input', 'короткий ключ — bad_input');

-- ---------- только сервер ----------
reset role;
select ok(not has_function_privilege('authenticated', 'public.group_star_stats(uuid, uuid)', 'execute'),
  'клиент не вызывает group_star_stats');
select ok(not has_function_privilege('authenticated', 'public.group_report_spending(uuid, uuid)', 'execute'),
  'клиент не вызывает group_report_spending');
select ok(not has_function_privilege('authenticated', 'public.group_report_progress(uuid, uuid, text[], text[])',
  'execute'), 'клиент не вызывает group_report_progress');
select ok(not has_function_privilege('authenticated', 'public.set_student_disabled(uuid, uuid, boolean)', 'execute'),
  'клиент не вызывает set_student_disabled');
select ok(not has_function_privilege('anon', 'public.grant_stars_group(uuid, uuid, integer, text, text, text)',
  'execute') and not has_function_privilege('authenticated',
  'public.grant_stars_group(uuid, uuid, integer, text, text, text)', 'execute'), 'клиент не вызывает grant_stars_group');
select ok(has_function_privilege('service_role', 'public.grant_stars_group(uuid, uuid, integer, text, text, text)',
  'execute'), 'сервер вызывает grant_stars_group');

select * from finish();
rollback;
