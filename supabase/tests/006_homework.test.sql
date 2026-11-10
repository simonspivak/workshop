-- Домашки (homework_submissions): RLS, гранты, одна действующая сдача на ученика и урок, типы бакета.
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ---------- данные: два учителя, две группы, ученики Анна и Борис (группа 61), Вера (группа 62) ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000061', 'teacher61@example.test'),
  ('a0000000-0000-4000-8000-000000000062', 'teacher62@example.test'),
  ('a0000000-0000-4000-8000-000000000063', 'admin63@example.test');
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000061', 'a0000000-0000-4000-8000-000000000062');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000063';
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000061', 'g61', 'Группа 61', 'a0000000-0000-4000-8000-000000000061', 100),
  ('b0000000-0000-4000-8000-000000000062', 'g62', 'Группа 62', 'a0000000-0000-4000-8000-000000000062', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000061', 'g61-anna@students.example.test',
   '{"login": "g61-anna", "nickname": "Анна", "group_id": "b0000000-0000-4000-8000-000000000061"}'),
  ('c0000000-0000-4000-8000-000000000062', 'g61-boris@students.example.test',
   '{"login": "g61-boris", "nickname": "Борис", "group_id": "b0000000-0000-4000-8000-000000000061"}'),
  ('c0000000-0000-4000-8000-000000000063', 'g62-vera@students.example.test',
   '{"login": "g62-vera", "nickname": "Вера", "group_id": "b0000000-0000-4000-8000-000000000062"}');

-- сдачи пишет только сервер
set local role service_role;
insert into public.homework_submissions (id, user_id, group_id, lesson_id, kind, text_body, status, ai_score, ai_feedback, ai_model, graded_at)
values ('d0000000-0000-4000-8000-000000000061', 'c0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000061',
        'lesson-1', 'text', 'Моя переписка с ИИ', 'graded', 7,
        '{"criteria": [{"name": "Есть 5 промптов", "verdict": "да", "note": "Пять подряд"}], "summary": "Хорошо", "tips": ["Добавь вывод"]}',
        'claude-haiku-5-5', now());
insert into public.homework_submissions (id, user_id, group_id, lesson_id, kind, file_name, mime, storage_path, size_bytes, status, ai_error)
values ('d0000000-0000-4000-8000-000000000062', 'c0000000-0000-4000-8000-000000000062', 'b0000000-0000-4000-8000-000000000061',
        'lesson-1', 'file', 'cover.png', 'image/png',
        'c0000000-0000-4000-8000-000000000062/homework/d0000000-0000-4000-8000-000000000062.png', 1024, 'submitted', 'media');
insert into public.homework_submissions (user_id, group_id, lesson_id, kind, link_url, status)
values ('c0000000-0000-4000-8000-000000000063', 'b0000000-0000-4000-8000-000000000062', 'lesson-4', 'link', 'https://example.test/b/vera', 'submitted');

select is((select count(*)::int from public.homework_submissions), 3, 'сервер записал три сдачи');

-- одна действующая сдача на ученика и урок
select throws_ok($$ insert into public.homework_submissions (user_id, group_id, lesson_id, kind, text_body, status)
                    values ('c0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000061', 'lesson-1', 'text', 'ещё раз', 'submitted') $$,
  '23505', null, 'вторая действующая сдача по тому же уроку не вставляется');
update public.homework_submissions set superseded_at = now() where id = 'd0000000-0000-4000-8000-000000000061';
select lives_ok($$ insert into public.homework_submissions (user_id, group_id, lesson_id, kind, text_body, status)
                   values ('c0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000061', 'lesson-1', 'text', 'ещё раз', 'submitted') $$,
  'после «сдать заново» (прошлая в истории) новая сдача вставляется');
select is((select count(*)::int from public.homework_submissions
            where user_id = 'c0000000-0000-4000-8000-000000000061' and lesson_id = 'lesson-1'), 2,
  'история сдач сохраняется');

-- проверки полей
select throws_ok($$ insert into public.homework_submissions (user_id, lesson_id, kind, status)
                    values ('c0000000-0000-4000-8000-000000000062', 'lesson-2', 'text', 'submitted') $$,
  '23514', null, 'текстовая сдача без текста не проходит');
select throws_ok($$ insert into public.homework_submissions (user_id, lesson_id, kind, link_url, status)
                    values ('c0000000-0000-4000-8000-000000000062', 'lesson-2', 'link', 'http://insecure.test', 'submitted') $$,
  '23514', null, 'ссылка только https');
select throws_ok($$ update public.homework_submissions set ai_score = 11 where id = 'd0000000-0000-4000-8000-000000000062' $$,
  '23514', null, 'оценка ИИ только 1–10');
select throws_ok($$ update public.homework_submissions set teacher_score = 0 where id = 'd0000000-0000-4000-8000-000000000062' $$,
  '23514', null, 'оценка ведущего только 1–10');
select throws_ok($$ update public.homework_submissions set status = 'checked' where id = 'd0000000-0000-4000-8000-000000000062' $$,
  '23514', null, 'статус только из списка');

-- updated_at обновляется триггером
update public.homework_submissions set teacher_score = 9, teacher_comment = 'Молодец', updated_at = '2020-01-01'
 where id = 'd0000000-0000-4000-8000-000000000062';
select ok((select updated_at > '2021-01-01' from public.homework_submissions where id = 'd0000000-0000-4000-8000-000000000062'),
  'updated_at ставит триггер, а не клиент');

-- бакет media принимает документы (миграция добавила типы, старые остались)
select ok((select 'application/pdf' = any(allowed_mime_types)
             and 'application/vnd.openxmlformats-officedocument.presentationml.presentation' = any(allowed_mime_types)
             and 'image/png' = any(allowed_mime_types) and 'video/mp4' = any(allowed_mime_types)
           from storage.buckets where id = 'media'),
  'бакет media принимает pdf, pptx и прежние типы');

-- ---------- ученица Анна: только свои сдачи ----------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000000-0000-4000-8000-000000000061", "role": "authenticated"}';
select is((select count(*)::int from public.homework_submissions), 2, 'ученица видит только свои сдачи (включая историю)');
select is((select count(*)::int from public.homework_submissions where user_id = 'c0000000-0000-4000-8000-000000000062'), 0,
  'сдачу одногруппника ученица не видит');
select throws_ok($$ insert into public.homework_submissions (user_id, lesson_id, kind, text_body, status)
                    values (auth.uid(), 'lesson-3', 'text', 'сам', 'graded') $$, '42501', null,
  'клиент не создаёт сдачу напрямую');
select throws_ok($$ update public.homework_submissions set ai_score = 10 where user_id = auth.uid() $$, '42501', null,
  'клиент не меняет оценку');
select throws_ok($$ delete from public.homework_submissions where user_id = auth.uid() $$, '42501', null,
  'клиент не удаляет сдачи');

-- ---------- учитель 61: сдачи своей группы, чужой — нет ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000061", "role": "authenticated"}';
select is((select count(*)::int from public.homework_submissions), 3, 'ведущий видит все сдачи своей группы');
select is((select count(*)::int from public.homework_submissions where group_id = 'b0000000-0000-4000-8000-000000000062'), 0,
  'сдачи чужой группы ведущему не видны');
select throws_ok($$ update public.homework_submissions set teacher_score = 10 $$, '42501', null,
  'ведущий ставит оценку только через сервер');

-- ---------- админ ----------
set local request.jwt.claims to '{"sub": "a0000000-0000-4000-8000-000000000063", "role": "authenticated"}';
select is((select count(*)::int from public.homework_submissions), 4, 'админ видит все сдачи');

select * from finish();
rollback;
