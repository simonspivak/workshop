-- ============================================================================
-- Брошенные задачи генерации (аудит 8 ноября, № 16 и № 19; docs/platform/audit/2026-11-09-verified.md,
-- DB-04 и GEN-03).
--
-- create_job перед подсчётом активных задач (лимит 5) возвращает звёзды за свои задачи
-- в очереди без taskId старше 90 секунд (кроме монтажа: его загрузка идёт из браузера
-- и закрывается студией). Такую задачу бросил запрос, который её вёл: функцию убили
-- по maxDuration 60 с или упала база между списанием и завершением. Раньше она висела
-- queued навсегда, звёзды не возвращались, а пять таких задач блокировали генерации.
--
-- Тело функции — как в 20261116120000_staff_caps.sql, добавлен только блок перед подсчётом.
-- Данные не меняются (кроме возврата звёзд за такие задачи при следующем create_job ученика).
-- Миграцию можно применить повторно. Тесты: supabase/tests/009_job_sweep.test.sql.
--
-- Обход для задач, которых никто не опрашивает (№ 19), — без SQL: POST /api/jobs/sweep
-- (lib/server/job-sweep.ts) по Vercel Cron раз в сутки.
-- ============================================================================

create or replace function public.create_job(
  p_user            uuid,
  p_action          text,
  p_model           text,
  p_stars           integer,
  p_idempotency_key text,
  p_params          jsonb default '{}'::jsonb,
  p_prompt          text default null,
  p_lesson_id       text default null,
  p_task_ref        text default null
) returns table (job_id uuid, balance integer, reused boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_job        uuid;
  v_balance    integer;
  v_group      uuid;
  v_role       public.app_role;
  v_min_price  integer;
  v_staff_only boolean;
  v_estimate   numeric;
  v_duration   numeric;
  v_cap        numeric;
  v_used       numeric;
  v_day_start  timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  v_stale      uuid;
begin
  if p_stars is null or p_stars < 0 or p_stars > 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;

  select j.id into v_job from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idempotency_key;
  if found then
    return query select v_job, (select w.balance from public.wallets w where w.user_id = p_user), true;
    return;
  end if;

  if p_action <> 'montage' and not private.generation_enabled() then
    raise exception 'generation_disabled' using errcode = 'P0001';
  end if;

  -- блокирует кошелёк: дальнейшие проверки одного пользователя идут по очереди
  v_balance := private.lock_for_spend(p_user, p_stars, true);

  -- повторная проверка под блокировкой кошелька: два одновременных клика
  select j.id into v_job from public.jobs j where j.user_id = p_user and j.idempotency_key = p_idempotency_key;
  if found then
    return query select v_job, v_balance, true;
    return;
  end if;

  -- Аудит № 16: задача, которую запрос бросил между create_job и mark_job_submitted/complete_job
  -- (функцию убили, упала база), висит queued со списанными звёздами и занимает лимит 5.
  -- Через 90 с её запрос точно мёртв (maxDuration /api/generate 60 с; job-rules
  -- QUEUED_WITHOUT_TASK_LIMIT_MS) — возвращаем звёзды до подсчёта активных.
  -- skip locked: задачу, которую прямо сейчас закрывает опрос (refund_job держит её строку
  -- и ждёт кошелёк, который держим мы), не ждём — иначе взаимная блокировка.
  for v_stale in
    select j.id from public.jobs j
     where j.user_id = p_user and j.status = 'queued' and j.gateway_task_id is null
       and j.action <> 'montage' and j.created_at < now() - interval '90 seconds'
     order by j.created_at
     for update of j skip locked
  loop
    perform public.refund_job(v_stale, 'gateway_lost: stale queued');
  end loop;
  if found then
    select w.balance into v_balance from public.wallets w where w.user_id = p_user;
  end if;

  if p_action <> 'montage' and (select count(*) from public.jobs j
       where j.user_id = p_user and j.status in ('queued', 'submitted', 'storing')) >= 5 then
    raise exception 'too_many_jobs' using errcode = 'P0001';
  end if;

  -- Вторая линия защиты от ошибок сервера: модель из прайса, ученику — не дешевле прайса
  -- и не модели «только для учителя».
  select p.role, p.group_id into v_role, v_group from public.profiles p where p.id = p_user;
  select min(pl.stars), bool_and(pl.access = 'staff'), max(coalesce(pl.kie_credits, 100))
    into v_min_price, v_staff_only, v_estimate
    from public.price_list pl where pl.action = p_action and pl.model = p_model and pl.enabled;
  if v_min_price is null then raise exception 'unknown_model' using errcode = 'P0001'; end if;
  if v_role = 'student' and (v_staff_only or p_stars < v_min_price) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Видео: оценка за каждые 5 с (по умолчанию 5 с)
  if p_action = 'video' then
    v_duration := case when jsonb_typeof(p_params -> 'duration') = 'number'
                       then (p_params ->> 'duration')::numeric else 5 end;
    v_estimate := v_estimate * ceil(least(greatest(v_duration, 1), 60) / 5);
  end if;

  -- Потолок кредитов kie для ведущего и админа (звёзд они не тратят)
  if v_role in ('teacher', 'admin') and p_action <> 'montage' then
    v_cap := (select (s.value #>> '{}')::numeric from public.settings s where s.key = 'staff_daily_credits');
    if v_cap is not null then
      select coalesce(sum(coalesce(j.credits, j.kie_estimate, 0)), 0) into v_used
        from public.jobs j
       where j.user_id = p_user and j.created_at >= v_day_start and j.status <> 'failed';
      if v_used + v_estimate > v_cap then
        raise exception 'staff_daily_cap' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if v_balance < p_stars then
    raise exception 'insufficient_stars' using errcode = 'P0001';
  end if;

  insert into public.jobs (user_id, group_id, action, model, params, prompt, stars, idempotency_key,
                           lesson_id, task_ref, kie_estimate)
  values (p_user, v_group, p_action, p_model, coalesce(p_params, '{}'::jsonb), p_prompt, p_stars,
          p_idempotency_key, p_lesson_id, p_task_ref, v_estimate)
  returning id into v_job;

  if p_stars > 0 then
    update public.wallets w set balance = w.balance - p_stars, updated_at = now()
     where w.user_id = p_user returning w.balance into v_balance;
    insert into public.star_ledger (user_id, delta, reason, balance_after, job_id, actor_id)
    values (p_user, -p_stars, 'debit', v_balance, v_job, p_user);
  end if;

  return query select v_job, v_balance, false;
end $$;

revoke all on function public.create_job(uuid, text, text, integer, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_job(uuid, text, text, integer, text, jsonb, text, text, text)
  to service_role;
