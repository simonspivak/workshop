-- ============================================================================
-- Потолки для аккаунтов ведущих (аудит 8 ноября, № 10; docs/platform/audit/2026-11-09-verified.md, SEC-01).
--
-- Ведущий и админ генерируют за 0★, а платит владелец кредитами kie. Утечка одного пароля
-- ведущего = ночь параллельных Seedance 2.5 и пустой баланс kie к уроку. Здесь:
--
-- 1. Дневной потолок кредитов kie на каждый аккаунт ведущего и админа (не звёзд).
--    price_list.kie_credits — оценка кредитов за задачу (для видео — за каждые 5 с).
--    create_job запоминает оценку в jobs.kie_estimate и под блокировкой кошелька (та же
--    транзакция, что пишет задачу) считает: за сегодня (Europe/Berlin) по задачам этого
--    пользователя, кроме failed, sum(coalesce(credits по ответу шлюза, оценка)) + оценка новой.
--    Больше settings.staff_daily_credits → исключение staff_daily_cap.
--    По умолчанию 3000 кредитов ≈ $15 в сутки на аккаунт: это ~20 клипов Seedance 2.5 по 5 с
--    (140 кр) или ~10 по 10 с — с запасом на демо урока и сцены сериала ведущего
--    (docs/course/series.md §6), при этом утечка пароля стоит не больше $15 в сутки вместо ~$140 в час.
--    null — без потолка. Ученики потолком не ограничены: их тратит звёздный кошелёк.
--
-- 2. Начисления звёзд (grant_stars) ведущим: не больше settings.teacher_grant_max за раз
--    (1000★) и settings.teacher_grant_daily в сутки на ведущего (5000★, только начисления,
--    снятие не считается). Больше → исключение grant_limit. Админ может превысить: тогда
--    в audit_log 'stars.grant' пишется over_limit: true. Параллельные начисления одного
--    ведущего идут по очереди (advisory-блокировка по ведущему).
--
-- 3. Рубильник «Стоп генераций» — существующая настройка generation_enabled (init.sql), здесь
--    не меняется; кнопка в кабинете админа.
--
-- Миграция не трогает существующие строки, кроме заполнения пустой price_list.kie_credits,
-- и не перезаписывает настройки, если админ их уже задал. Её можно применить повторно.
-- Тесты: supabase/tests/007_staff_caps.test.sql.
-- ============================================================================

-- ===== 1. Оценка кредитов kie =================================================

alter table public.price_list
  add column if not exists kie_credits numeric check (kie_credits >= 0);

comment on column public.price_list.kie_credits is
  'Оценка кредитов kie за одну задачу (видео — за каждые 5 с). Только для потолка ведущих; null — 100.';

alter table public.jobs
  add column if not exists kie_estimate numeric check (kie_estimate >= 0);

comment on column public.jobs.kie_estimate is
  'Оценка кредитов kie на момент создания задачи (create_job). Фактические — в credits.';

-- Цифры — docs/kie-gateway.md (живые запросы 1 ноября); где замеров нет — оценка с запасом.
update public.price_list pl
   set kie_credits = v.credits
  from (values
    ('text',       'claude-haiku-5-5',             1),     -- на деле Kimi K3: 0,72 кр за короткий ответ
    ('text',       'gpt-6-luna',                   1),
    ('text',       'claude-sonnet-5-5',            2),     -- замера нет
    ('image',      'flux-3/klein-text-to-image',   2),     -- 1,6
    ('image',      'nano-banana-2-1',              4),
    ('image',      'nano-banana-pro',              15),    -- замера нет
    ('image_edit', 'flux-3/klein-edit-image',      2),
    ('image_edit', 'nano-banana-2-1',              4),
    ('image_edit', 'nano-banana-pro',              15),
    ('video',      'bytedance/seedance-2-mini',    19),    -- за 5 с, 480p
    ('video',      'bytedance/seedance-2-5',       140),   -- за 5 с, 480p (28 кр/с)
    ('video',      'kling-4.0/reference-to-video', 145),   -- 142,5 за 5 с
    ('video',      'wan/3-0-video',                40),
    ('video',      'wan/3-0-video-prime',          80),    -- замера нет
    ('voice',      'google/gemini-3-8-flash-tts',  1),     -- 0,21
    ('music',      'ai-music-api/generate',        12),
    ('motion',     'kling-2.6/motion-control',     60),    -- замера нет
    ('motion',     'wan/2-2-animate-move',         40),    -- замера нет
    ('lipsync',    'kling/ai-avatar-standard',     48),
    ('lipsync',    'infinitalk/from-audio',        40),    -- замера нет
    ('montage',    'platform/auto-montage',        0),     -- в браузере, kie не участвует
    ('bot_reply',  'claude-haiku-5-5',             1)
  ) as v(action, model, credits)
 where pl.action = v.action and pl.model = v.model and pl.kie_credits is null;

-- ===== 2. Настройки (админ меняет без деплоя; null — без лимита) ================

insert into public.settings (key, value) values
  ('staff_daily_credits', '3000'),   -- кредитов kie в сутки на аккаунт ведущего или админа
  ('teacher_grant_max',   '1000'),   -- ★ за одно начисление ведущим
  ('teacher_grant_daily', '5000')    -- ★ начислений одного ведущего за сутки
on conflict (key) do nothing;

-- ===== 3. create_job: потолок кредитов ведущего ===============================
-- Тело как в 20261101200000_init.sql; добавлены оценка кредитов и потолок для staff.

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

-- ===== 4. grant_stars: лимиты начислений ведущего =============================
-- Тело как в 20261101200000_init.sql; добавлены лимит за раз и за сутки.

create index if not exists star_ledger_actor_grant_idx
  on public.star_ledger (actor_id, created_at) where reason = 'grant';

create or replace function public.grant_stars(
  p_actor           uuid,
  p_user            uuid,
  p_amount          integer,
  p_note            text default null,
  p_idempotency_key text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_role      public.app_role;
  v_group     uuid;
  v_ok        boolean;
  v_balance   integer;
  v_max       integer;
  v_daily     integer;
  v_granted   bigint;
  v_over      boolean := false;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_actor and not p.disabled;
  select p.group_id into v_group from public.profiles p where p.id = p_user;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  v_ok := v_role = 'admin'
          or (v_role = 'teacher' and exists (
                select 1 from public.groups g where g.id = v_group and g.teacher_id = p_actor));
  if not coalesce(v_ok, false) then raise exception 'forbidden' using errcode = 'P0001'; end if;

  -- начисления одного ведущего — по очереди, иначе параллельные запросы видят одну сумму за день
  if p_amount > 0 then
    perform pg_advisory_xact_lock(hashtextextended('grant_stars:' || p_actor::text, 0));
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id = p_user for update;
  if not found then
    insert into public.wallets (user_id, balance) values (p_user, 0) returning balance into v_balance;
  end if;

  if p_idempotency_key is not null and exists (
       select 1 from public.star_ledger l where l.user_id = p_user and l.idempotency_key = p_idempotency_key) then
    return v_balance;
  end if;

  if p_amount > 0 then
    v_max := (select (s.value #>> '{}')::integer from public.settings s where s.key = 'teacher_grant_max');
    v_daily := (select (s.value #>> '{}')::integer from public.settings s where s.key = 'teacher_grant_daily');
    select coalesce(sum(l.delta), 0) into v_granted from public.star_ledger l
     where l.actor_id = p_actor and l.reason = 'grant' and l.created_at >= v_day_start;
    v_over := (v_max is not null and p_amount > v_max)
              or (v_daily is not null and v_granted + p_amount > v_daily);
    if v_over and v_role <> 'admin' then
      raise exception 'grant_limit' using errcode = 'P0001';
    end if;
  end if;

  if v_balance + p_amount < 0 then raise exception 'insufficient_stars' using errcode = 'P0001'; end if;

  update public.wallets w set balance = w.balance + p_amount, updated_at = now()
   where w.user_id = p_user returning w.balance into v_balance;
  insert into public.star_ledger (user_id, delta, reason, balance_after, actor_id, note, idempotency_key)
  values (p_user, p_amount, case when p_amount > 0 then 'grant' else 'adjust' end, v_balance, p_actor,
          left(p_note, 200), p_idempotency_key);
  insert into public.audit_log (actor_id, action, target_user, target_group, meta)
  values (p_actor, 'stars.grant', p_user, v_group,
          jsonb_build_object('amount', p_amount, 'note', left(p_note, 200), 'balance', v_balance)
            || case when v_over then jsonb_build_object('over_limit', true) else '{}'::jsonb end);
  return v_balance;
end $$;

-- ===== 5. Права: как в init.sql — только сервер =================================

revoke all on function public.create_job(uuid, text, text, integer, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_job(uuid, text, text, integer, text, jsonb, text, text, text)
  to service_role;
revoke all on function public.grant_stars(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.grant_stars(uuid, uuid, integer, text, text) to service_role;
