-- ============================================================================
-- Домашки: длинные работы и результаты из галереи (16 ноября 2026).
--
-- 1. Длинные работы. Урок 1 просит вставить всю переписку с ИИ и обсуждение с ребятами —
--    это больше 20 000 знаков: форма обрезала текст, модель видела только начало.
--    Текст работы и комментарий ученика (text_body) — до 100 000 знаков.
--    Комментарий ведущего (teacher_comment ≤ 2 000) не меняется.
-- 2. Проверка по частям. Длинную работу модель читает частями по ~12 000 знаков: на каждую
--    часть — короткие заметки, потом оценка по заметкам. Одна часть — один вызов модели
--    (до ~40 с), поэтому между опросами браузера прогресс хранится в grading_progress
--    (jsonb: заметки по частям и сколько частей прочитано). Захват строки (grading_started_at)
--    и перехват зависшей проверки работают как раньше.
-- 3. Результаты из галереи. Урок 2 просит минимум 6 клипов — они уже лежат на платформе
--    (таблица jobs). Ученик прикрепляет к сдаче свои готовые результаты: attachments — jsonb-массив
--    id задач (не больше 20), файлы не копируются. Что id свои, готовые и не удалённые,
--    проверяет сервер при сдаче. Сдача «только результаты + пара слов» — kind = 'text',
--    у которой текста может не быть, если есть attachments.
--
-- RLS и гранты не меняются: клиент читает строки (свои / своей группы) по политике
-- homework_submissions_read, select выдан на всю таблицу, поэтому новые колонки видны тем же,
-- кто видит строку; пишет только service_role.
-- Существующие строки не меняются: новые колонки nullable, проверки только расширяются.
-- Миграцию можно применить повторно. Тесты: supabase/tests/013_homework_long.test.sql.
-- ============================================================================

-- ===== 1. Новые колонки ========================================================

alter table public.homework_submissions
  add column if not exists attachments jsonb,
  add column if not exists grading_progress jsonb;

-- ===== 2. Проверки: старые (без имени, их имена выдал Postgres) снимаются по тексту ===

do $$
declare
  c record;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.homework_submissions'::regclass and contype = 'c'
  loop
    -- text_body ≤ 20 000 (колонка) и «текстовая сдача — с текстом» (таблица)
    if (c.def like '%char_length(text_body)%' and c.conname <> 'homework_submissions_text_body_len')
       or (c.def like '%''text''::text%' and c.def like '%text_body IS NOT NULL%'
           and c.conname <> 'homework_submissions_text_present') then
      execute format('alter table public.homework_submissions drop constraint %I', c.conname);
    end if;
  end loop;
end $$;

alter table public.homework_submissions
  drop constraint if exists homework_submissions_text_body_len,
  add constraint homework_submissions_text_body_len check (char_length(text_body) <= 100000);

-- текстовая сдача — с текстом или хотя бы с результатами из галереи
alter table public.homework_submissions
  drop constraint if exists homework_submissions_text_present,
  add constraint homework_submissions_text_present
    check (kind <> 'text' or text_body is not null or attachments is not null);

-- attachments: непустой массив id задач (строки), не больше 20
alter table public.homework_submissions
  drop constraint if exists homework_submissions_attachments_shape,
  add constraint homework_submissions_attachments_shape
    check (attachments is null or (
      jsonb_typeof(attachments) = 'array'
      and jsonb_array_length(attachments) between 1 and 20
      and octet_length(attachments::text) <= 1024));

-- grading_progress: объект, заметки 10 частей по ~900 знаков с запасом
alter table public.homework_submissions
  drop constraint if exists homework_submissions_grading_progress_shape,
  add constraint homework_submissions_grading_progress_shape
    check (grading_progress is null or (
      jsonb_typeof(grading_progress) = 'object'
      and octet_length(grading_progress::text) <= 65536));

comment on column public.homework_submissions.attachments is
  'Результаты из галереи, прикреплённые к сдаче: jsonb-массив id задач (jobs.id) ученика, ≤ 20. Файлы не копируются.';
comment on column public.homework_submissions.grading_progress is
  'Проверка длинной работы по частям: {v, chars, total, all, notes[], failures}. Пишет только сервер.';
