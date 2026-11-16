-- ============================================================================
-- Боты: мелкие находки аудита 8 ноября (№ 39 и № 45; docs/platform/audit/2026-11-09-verified.md,
-- DB-05 и BP-6).
--
-- 1. group_bot_counters — счётчики страницы ведущего «Боты группы» одним запросом.
--    Раньше сервер делал два COUNT на каждого бота (2 + 2N запросов: 102 на группу из 50).
--    Фильтры — те же, что были в lib/server/bot/dal.ts: заявки бота за всё время; сообщения
--    гостей (role = 'user', не проверка владельцем owner:…) с p_since.
-- 2. create_bot_card_job — открытка гостю. Лимит «3 открытки в сутки на бота» проверялся
--    отдельным запросом до create_job: параллельные подтверждения проходили все сразу.
--    Теперь проверка и create_job — одна транзакция под блокировкой открыток этого бота
--    (advisory lock по task_ref). Заодно открыток в работе у бота не больше p_active_limit
--    (сервер передаёт 2): гости не занимают все 5 мест владельца для генераций.
--    create_job не меняется: обёртка вызывает её в той же транзакции. Порядок блокировок:
--    открытки бота → (внутри create_job) группа и кошелёк; обычная create_job блокировку
--    открыток не берёт, поэтому взаимной блокировки нет.
--
-- Данные не меняются, таблицы и индексы не трогаются. Миграцию можно применить повторно.
-- Вызывает только service_role (сервер). Тесты: supabase/tests/011_bot_low.test.sql.
-- ============================================================================

-- ===== 1. Счётчики ботов группы ================================================

-- Индексы: bot_leads_bot_idx (bot_id, created_at desc), bot_messages_bot_day_idx (bot_id, created_at desc)
create or replace function public.group_bot_counters(p_bot_ids uuid[], p_since timestamptz)
returns table (bot_id uuid, leads_count bigint, guest_messages bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(array_length(p_bot_ids, 1), 0) > 1000 then
    raise exception 'too_many_bots' using errcode = 'P0001';
  end if;
  return query
  select b.id,
         (select count(*) from public.bot_leads l where l.bot_id = b.id),
         (select count(*) from public.bot_messages m
           where m.bot_id = b.id and m.role = 'user'
             and m.conversation_id not like 'owner:%'
             and m.created_at >= p_since)
    from public.bots b
   where b.id = any (coalesce(p_bot_ids, '{}'::uuid[]));
end $$;

revoke all on function public.group_bot_counters(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.group_bot_counters(uuid[], timestamptz) to service_role;

-- ===== 2. Открытка гостю: лимиты в одной транзакции с create_job =================

-- p_daily_limit  — открыток гостям (params.preview = false) за 24 часа на этот task_ref → 'card_limit';
-- p_active_limit — открыток этого task_ref в работе (queued, submitted, storing) → 'too_many_jobs'.
-- Повтор того же билета (тот же p_idempotency_key) лимиты не проверяет: create_job вернёт ту же задачу.
create or replace function public.create_bot_card_job(
  p_user            uuid,
  p_action          text,
  p_model           text,
  p_stars           integer,
  p_idempotency_key text,
  p_params          jsonb,
  p_prompt          text,
  p_task_ref        text,
  p_daily_limit     integer,
  p_active_limit    integer
) returns table (job_id uuid, balance integer, reused boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if p_task_ref is null or p_task_ref not like 'bot-card:%' or char_length(p_task_ref) > 100 then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_daily_limit is null or p_daily_limit < 0 or p_active_limit is null or p_active_limit < 1 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;

  -- До конца транзакции: открытки одного бота создаются по очереди
  perform pg_advisory_xact_lock(hashtextextended('jobs:task_ref:' || p_task_ref, 0));

  if not exists (select 1 from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idempotency_key) then
    if (select count(*) from public.jobs j
         where j.user_id = p_user and j.task_ref = p_task_ref
           and coalesce(j.params ->> 'preview', 'false') = 'false'
           and j.created_at >= now() - interval '24 hours') >= p_daily_limit then
      raise exception 'card_limit' using errcode = 'P0001';
    end if;
    if (select count(*) from public.jobs j
         where j.user_id = p_user and j.task_ref = p_task_ref
           and j.status in ('queued', 'submitted', 'storing')) >= p_active_limit then
      raise exception 'too_many_jobs' using errcode = 'P0001';
    end if;
  end if;

  return query
  select c.job_id, c.balance, c.reused
    from public.create_job(p_user, p_action, p_model, p_stars, p_idempotency_key,
                           coalesce(p_params, '{}'::jsonb), p_prompt, null, p_task_ref) c;
end $$;

revoke all on function public.create_bot_card_job(uuid, text, text, integer, text, jsonb, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_card_job(uuid, text, text, integer, text, jsonb, text, text, integer, integer)
  to service_role;
