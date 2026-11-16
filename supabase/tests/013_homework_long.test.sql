-- Домашки: длинные работы (text_body до 100 000), результаты из галереи (attachments),
-- прогресс проверки по частям (grading_progress). Миграция 20261116200000_homework_long_attachments.
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ---------- данные: ведущий, группа 71, ученица Ада, ученик Бен (группа 71), ученица Ева (группа 72) ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000071', 'teacher71@example.test'),
  ('a0000000-0000-4000-8000-000000000072', 'teacher72@example.test');
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000071', 'a0000000-0000-4000-8000-000000000072');
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000071', 'g71', 'Группа 71', 'a0000000-0000-4000-8000-000000000071', 100),
  ('b0000000-0000-4000-8000-000000000072', 'g72', 'Группа 72', 'a0000000-0000-4000-8000-000000000072', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000071', 'g71-ada@students.example.test',
   '{"login": "g71-ada", "nickname": "Ада", "group_id": "b0000000-0000-4000-8000-000000000071"}'),
  ('c0000000-0000-4000-8000-000000000072', 'g71-ben@students.example.test',
   '{"login": "g71-ben", "nickname": "Бен", "group_id": "b0000000-0000-4000-8000-000000000071"}'),
  ('c0000000-0000-4000-8000-000000000073', 'g72-eva@students.example.test',
   '{"login": "g72-eva", "nickname": "Ева", "group_id": "b0000000-0000-4000-8000-000000000072"}');

set local role service_role;

-- 1–3. длина text_body: 100 000 проходит, 100 001 — нет; старый предел 20 000 снят
select lives_ok($$ insert into public.homework_submissions (id, user_id, group_id, lesson_id, kind, text_body, status)
                   values ('d0000000-0000-4000-8000-000000000071', 'c0000000-0000-4000-8000-000000000071',
                           'b0000000-0000-4000-8000-000000000071', 'lesson-1', 'text', repeat('ж', 100000), 'submitted') $$,
  'текст работы в 100 000 знаков (кириллица) сохраняется');
select throws_ok($$ insert into public.homework_submissions (user_id, group_id, lesson_id, kind, text_body, status)
                    values ('c0000000-0000-4000-8000-000000000071', 'b0000000-0000-4000-8000-000000000071',
                            'lesson-3', 'text', repeat('ж', 100001), 'submitted') $$,
  '23514', null, 'текст длиннее 100 000 знаков не проходит');
select is((select count(*)::int from pg_constraint
            where conrelid = 'public.homework_submissions'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%char_length(text_body)%'), 1,
  'проверка длины text_body одна (старая на 20 000 снята)');

-- 4–5. комментарий к файлу тоже до 100 000
select lives_ok($$ insert into public.homework_submissions (user_id, group_id, lesson_id, kind, file_name, mime, storage_path, size_bytes, text_body, status)
                   values ('c0000000-0000-4000-8000-000000000072', 'b0000000-0000-4000-8000-000000000071', 'lesson-1', 'file',
                           'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                           'c0000000-0000-4000-8000-000000000072/homework/x.pptx', 2048, repeat('переписка ', 9000), 'submitted') $$,
  'комментарий к файлу в 90 000 знаков сохраняется');
select is((select char_length(text_body) from public.homework_submissions
            where user_id = 'c0000000-0000-4000-8000-000000000072' and lesson_id = 'lesson-1'), 90000,
  'комментарий не обрезан');

-- 6–9. attachments: массив до 20 id; текстовая сдача может быть «только результаты»
select lives_ok($$ insert into public.homework_submissions (id, user_id, group_id, lesson_id, kind, attachments, status)
                   values ('d0000000-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000071',
                           'b0000000-0000-4000-8000-000000000071', 'lesson-2', 'text',
                           '["e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002"]', 'submitted') $$,
  'текстовая сдача без текста, но с результатами из галереи сохраняется');
select throws_ok($$ insert into public.homework_submissions (user_id, group_id, lesson_id, kind, status)
                    values ('c0000000-0000-4000-8000-000000000071', 'b0000000-0000-4000-8000-000000000071', 'lesson-4', 'text', 'submitted') $$,
  '23514', null, 'текстовая сдача без текста и без результатов не проходит');
select throws_ok($$ update public.homework_submissions
                       set attachments = (select jsonb_agg(gen_random_uuid()::text) from generate_series(1, 21))
                     where id = 'd0000000-0000-4000-8000-000000000072' $$,
  '23514', null, 'больше 20 результатов не прикрепить');
select throws_ok($$ update public.homework_submissions set attachments = '{"id": "x"}'
                     where id = 'd0000000-0000-4000-8000-000000000072' $$,
  '23514', null, 'attachments — только массив');
select throws_ok($$ update public.homework_submissions set attachments = '[]'
                     where id = 'd0000000-0000-4000-8000-000000000072' $$,
  '23514', null, 'пустой массив не хранится (нет результатов — null)');

-- 11–12. grading_progress: объект, пишет сервер
select lives_ok($$ update public.homework_submissions
                      set status = 'grading', grading_started_at = now(),
                          grading_progress = '{"v": 1, "chars": 100000, "total": 9, "all": 9, "notes": ["часть 1: есть переписка"], "failures": 0}'
                    where id = 'd0000000-0000-4000-8000-000000000071' $$,
  'сервер сохраняет прогресс проверки по частям');
select throws_ok($$ update public.homework_submissions set grading_progress = '["не объект"]'
                     where id = 'd0000000-0000-4000-8000-000000000071' $$,
  '23514', null, 'grading_progress — только объект');

-- ---------- ученица Ада: читает свои attachments и прогресс, писать не может ----------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000071", "role": "authenticated"}';
select is((select jsonb_array_length(attachments) from public.homework_submissions
            where id = 'd0000000-0000-4000-8000-000000000072'), 2,
  'ученица видит прикреплённые результаты своей сдачи');
select is((select (grading_progress ->> 'total')::int from public.homework_submissions
            where id = 'd0000000-0000-4000-8000-000000000071'), 9,
  'ученица видит прогресс проверки своей сдачи');
select throws_ok($$ update public.homework_submissions set attachments = null where user_id = auth.uid() $$, '42501', null,
  'клиент не меняет прикреплённые результаты');

-- ---------- ведущий чужой группы сдач группы 71 не видит ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000072", "role": "authenticated"}';
select is((select count(*)::int from public.homework_submissions where attachments is not null), 0,
  'ведущий другой группы не видит сдачи с результатами группы 71');

select * from finish();
rollback;
