-- ============================================================================
-- Домашки: сдача и автоматическая проверка ИИ (10 ноября 2026).
--
-- Ученик сдаёт домашку в уроке: файл (презентация, документ, PDF, картинка, видео, звук,
-- текст), текст или ссылку. Файл уходит прямо в Storage по подписанной ссылке (как монтаж):
-- сервер создаёт строку `uploading` → браузер кладёт файл → сервер проверяет файл, ставит
-- `submitted` и сразу проверяет работу моделью (Haiku, запасная Kimi): оценка 1–10,
-- критерии «да / частично / нет», выжимка и советы. Ученик видит оценку ИИ сразу (решение
-- владельца); ведущий может поставить свою оценку и комментарий — она показывается рядом.
-- Картинки, видео и звук модель не читает: такие работы ждут оценки ведущего.
--
-- Одна действующая сдача на ученика и урок: «Сдать заново» помечает прошлую superseded_at
-- (история остаётся), частичный уникальный индекс не даёт двух действующих строк.
-- Чтение: ученик — свои строки, ведущий — строки своих групп (private.teaches_group, как у jobs).
-- Пишет только сервер (service_role). Статусы: uploading → submitted → grading → graded | failed.
-- Файлы: бакет media, путь {user_id}/homework/{submission_id}.{ext}; бакету добавлены типы
-- документов (pdf, pptx, docx, txt, md) — остальные там уже были.
-- Миграция идемпотентна. Тесты: supabase/tests/006_homework.test.sql.
-- ============================================================================

create table if not exists public.homework_submissions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  group_id          uuid references public.groups (id) on delete set null,
  lesson_id         text not null check (lesson_id ~ '^[a-z0-9-]{1,40}$'),
  kind              text not null check (kind in ('file', 'text', 'link')),
  -- текст работы (kind = text) или комментарий к файлу / ссылке
  text_body         text check (char_length(text_body) <= 20000),
  link_url          text check (link_url ~ '^https://' and char_length(link_url) <= 500),
  storage_path      text check (char_length(storage_path) <= 300),
  file_name         text check (char_length(file_name) <= 200),
  mime              text check (char_length(mime) <= 120),
  size_bytes        integer check (size_bytes >= 0),
  status            text not null default 'uploading'
                    check (status in ('uploading', 'submitted', 'grading', 'graded', 'failed')),
  -- оценка ИИ
  ai_score          integer check (ai_score between 1 and 10),
  ai_feedback       jsonb check (ai_feedback is null or octet_length(ai_feedback::text) <= 16384),
  ai_model          text check (char_length(ai_model) <= 80),
  -- почему ИИ не оценил (failed) — короткий код или сообщение для журнала
  ai_error          text check (char_length(ai_error) <= 500),
  grading_started_at timestamptz,
  graded_at         timestamptz,
  -- оценка ведущего (перекрывает оценку ИИ в отчётах, показывается ученику рядом)
  teacher_score     integer check (teacher_score between 1 and 10),
  teacher_comment   text check (char_length(teacher_comment) <= 2000),
  teacher_id        uuid,
  teacher_graded_at timestamptz,
  superseded_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (kind <> 'text' or text_body is not null),
  check (kind <> 'link' or link_url is not null),
  check (kind <> 'file' or file_name is not null)
);

-- одна действующая сдача на ученика и урок
create unique index if not exists homework_submissions_active_once
  on public.homework_submissions (user_id, lesson_id) where superseded_at is null;
-- таблица ведущего: все действующие сдачи группы одним запросом
create index if not exists homework_submissions_group_idx
  on public.homework_submissions (group_id, created_at desc) where superseded_at is null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'touch_updated_at'
                   and tgrelid = 'public.homework_submissions'::regclass) then
    create trigger touch_updated_at before update on public.homework_submissions
      for each row execute function private.touch_updated_at();
  end if;
end $$;

-- ===== RLS и гранты (как у остальных таблиц: клиентам только чтение) ==========

alter table public.homework_submissions enable row level security;
revoke all on table public.homework_submissions from public, anon, authenticated, service_role;
grant select on public.homework_submissions to authenticated;
grant select, insert, update, delete on public.homework_submissions to service_role;

drop policy if exists homework_submissions_read on public.homework_submissions;
create policy homework_submissions_read on public.homework_submissions for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_group(group_id));

-- ===== Storage: типы документов для домашек ====================================
-- Бакет media создан в init (§14) с типами картинок, видео и звука. Добавляем документы.
-- Если прав на storage нет (NOTICE) — добавить типы вручную: Storage → media → Edit bucket.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = (
         select array_agg(distinct t) from unnest(
           coalesce(allowed_mime_types, array[]::text[]) || array[
             'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4',
             'audio/wav', 'audio/x-wav', 'audio/wave',
             'application/pdf',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'text/plain', 'text/markdown'
           ]) as t)
     where id = 'media';
  else
    raise notice 'storage.buckets not found: add document mime types to bucket "media" manually';
  end if;
exception when insufficient_privilege then
  raise notice 'no privilege on storage.buckets: add document mime types to bucket "media" manually';
end $$;
