-- ============================================================================
-- Удаление результата учеником (8 ноября 2026).
--
-- Ученик хочет убрать неудачную реплику, плохую картинку или неудавшуюся задачу из
-- «Результатов по заданию», галереи, студии и выбора референсов. Удаление мягкое: строка
-- остаётся (журнал звёзд и отчёты ведущего считают потраченное как прежде), deleted_at —
-- момент удаления; файлы из Storage сервер удаляет сразу. Звёзды не возвращаются.
-- Удалить можно только готовую или неудачную задачу (done, failed): свою — ученик,
-- любую в своей группе — ведущий (админ — любую). Пишет только сервер (service_role,
-- grant update на jobs есть с init); клиенты, как и раньше, jobs не меняют.
-- Отдельный индекс не нужен: удалённых строк мало, выборки идут по существующим индексам
-- (user_id, created_at) и (group_id, created_at) с фильтром deleted_at is null.
-- Миграция идемпотентна. Тесты: supabase/tests/005_job_delete.test.sql.
-- ============================================================================

alter table public.jobs add column if not exists deleted_at timestamptz;

-- Общая галерея группы: удалённое одногруппникам не видно и через RLS.
-- Своё и задачи учеников своих групп (ведущий) читаются как раньше — сервер фильтрует сам.
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.teaches_group(group_id)
    -- общая галерея группы, если учитель её включил: только готовые, не скрытые и не удалённые
    or (status = 'done' and not hidden and deleted_at is null and group_id = (select private.my_group_id())
        and exists (select 1 from public.groups g where g.id = group_id and g.share_gallery))
  );
