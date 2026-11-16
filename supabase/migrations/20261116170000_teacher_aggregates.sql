-- ============================================================================
-- Кабинет ведущего: агрегаты в SQL, отключение ученика, начисление всей группе,
-- бюджет у старых групп (аудит 8 ноября, № 14, 15, 26, 27, 56;
-- docs/platform/audit/2026-11-09-verified.md: DB-01, DB-02, TUX-01..03, TUX-14).
--
-- 1. PostgREST отдаёт не больше 1000 строк за запрос (Max Rows), а карточка «Звёзды группы»
--    и отчёт группы читали журнал звёзд и прогресс строками. Теперь сервер получает
--    готовые суммы: group_star_stats, group_report_spending, group_report_progress.
-- 2. set_student_disabled — ведущий отключает и включает ученика; при отключении все сессии
--    ученика закрываются (auth.sessions), запись в audit_log.
-- 3. grant_stars_group — «Начислить всем по N ★» (или «довести каждому до N ★») одним
--    вызовом. Каждое начисление идёт через grant_stars, поэтому действуют все её проверки и
--    лимиты ведущего (grant_limit, миграция 20261116120000_staff_caps). Вся пачка — одна
--    транзакция: при отказе не начисляется никому. Повтор с тем же ключом формы ничего не меняет.
-- 4. Группы, созданные до бюджета (20261103110000_group_budget), получают бюджет 0,
--    число учеников по факту и «каждому» как раньше — иначе их настройки не сохранить.
--
-- Все функции: security definer, search_path = '', первым аргументом — кто вызывает
-- (p_actor). Доступ — админ или ведущий этой группы (не отключённый), иначе 'forbidden'.
-- Вызывает только service_role (сервер), как grant_stars. RLS и существующие строки не меняются,
-- кроме заполнения пустого бюджета (пункт 4). Миграцию можно применить повторно.
-- Тесты: supabase/tests/010_teacher_aggregates.test.sql.
-- ============================================================================

-- ===== 0. Проверка доступа ====================================================

-- true — p_actor админ или ведущий группы p_group; отключённым — false
create or replace function private.actor_teaches_group(p_actor uuid, p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles a
     where a.id = p_actor and not a.disabled
       and (a.role = 'admin'
            or (a.role = 'teacher' and exists (
                  select 1 from public.groups g where g.id = p_group and g.teacher_id = p_actor)))
  )
$$;

revoke all on function private.actor_teaches_group(uuid, uuid) from public, anon, authenticated;

-- ===== 1. Агрегаты для карточки группы и отчёта ===============================

-- Звёзды группы: given — всё начисленное (стартовые, ведущий, бонусы тестов, снятия),
-- handed — только стартовые и ручные (welcome, grant, adjust) — с ним сравнивается бюджет,
-- spent — траты за вычетом возвратов.
create or replace function public.group_star_stats(p_actor uuid, p_group uuid)
returns table (given bigint, handed bigint, spent bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.actor_teaches_group(p_actor, p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
  select coalesce(sum(l.delta) filter (where l.reason not in ('debit', 'refund', 'bot_reply')), 0)::bigint,
         coalesce(sum(l.delta) filter (where l.reason in ('welcome', 'grant', 'adjust')), 0)::bigint,
         greatest(0, coalesce(sum(-l.delta) filter (where l.reason in ('debit', 'refund', 'bot_reply')), 0))::bigint
    from public.star_ledger l
    join public.profiles p on p.id = l.user_id
   where p.group_id = p_group and p.role = 'student';
end $$;

-- Траты по ученику: всего, сегодня (день по Берлину, как дневной лимит в lock_for_spend),
-- число генераций, возвратов, ответов бота. Строка — только у тех, кто что-то тратил.
create or replace function public.group_report_spending(p_actor uuid, p_group uuid)
returns table (user_id uuid, spent_total bigint, spent_today bigint, generations integer, refunds integer,
               bot_replies integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  if not private.actor_teaches_group(p_actor, p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
  select l.user_id,
         coalesce(sum(-l.delta), 0)::bigint,
         coalesce(sum(-l.delta) filter (where l.created_at >= v_day_start), 0)::bigint,
         (count(*) filter (where l.reason = 'debit'))::integer,
         (count(*) filter (where l.reason = 'refund'))::integer,
         (count(*) filter (where l.reason = 'bot_reply'))::integer
    from public.star_ledger l
    join public.profiles p on p.id = l.user_id
   where p.group_id = p_group and p.role = 'student'
     and l.reason in ('debit', 'refund', 'bot_reply')
   group by l.user_id;
end $$;

-- Отмеченные шаги по ученику и уроку. Считаются только шаги текущей версии уроков:
-- сервер передаёт пары (урок, шаг) двумя массивами одинаковой длины. Строки под старыми
-- id заданий (после переименования) не считаются — как на странице урока у ученика.
create or replace function public.group_report_progress(p_actor uuid, p_group uuid, p_lessons text[], p_steps text[])
returns table (user_id uuid, lesson_id text, steps integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.actor_teaches_group(p_actor, p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_lessons), 0) <> coalesce(cardinality(p_steps), 0) then
    raise exception 'bad_input' using errcode = 'P0001';
  end if;
  return query
  select lp.user_id, lp.lesson_id, count(*)::integer
    from public.lesson_progress lp
    join public.profiles p on p.id = lp.user_id
    join (select distinct v.lesson_id, v.step from unnest(p_lessons, p_steps) as v(lesson_id, step)) cur
      on cur.lesson_id = lp.lesson_id and cur.step = lp.step
   where p.group_id = p_group and p.role = 'student'
   group by lp.user_id, lp.lesson_id;
end $$;

-- ===== 2. Отключить / включить ученика ========================================

-- Отключённый не входит (login), считается невошедшим (getUser), не тратит звёзды
-- (lock_for_spend), его бот отдыхает. Звёзды, работы и журнал остаются.
-- При отключении удаляем сессии ученика: обновить токен он уже не сможет ни на одном устройстве.
-- Возвращает true, если состояние изменилось (повтор того же действия — false, без записи в журнал).
create or replace function public.set_student_disabled(p_actor uuid, p_user uuid, p_disabled boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_role     public.app_role;
  v_group    uuid;
  v_disabled boolean;
  v_sessions integer := 0;
begin
  if p_disabled is null then raise exception 'bad_input' using errcode = 'P0001'; end if;

  select p.role, p.group_id, p.disabled into v_role, v_group, v_disabled
    from public.profiles p where p.id = p_user for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0001'; end if;
  -- только ученика группы; ведущих и админов отключает только админ в базе
  if v_role <> 'student' or v_group is null or not private.actor_teaches_group(p_actor, v_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_disabled = p_disabled then
    return false;
  end if;

  update public.profiles p set disabled = p_disabled where p.id = p_user;

  if p_disabled then
    -- auth.sessions — таблица Supabase Auth (refresh_tokens удаляются каскадом).
    -- Если её нет или нет прав, отключение всё равно действует: getUser и login проверяют флаг.
    begin
      delete from auth.sessions s where s.user_id = p_user;
      get diagnostics v_sessions = row_count;
    exception when undefined_table or insufficient_privilege then
      v_sessions := null;
    end;
  end if;

  insert into public.audit_log (actor_id, action, target_user, target_group, meta)
  values (p_actor, case when p_disabled then 'student.disable' else 'student.enable' end, p_user, v_group,
          case when p_disabled then jsonb_build_object('sessions', v_sessions) else '{}'::jsonb end);
  return true;
end $$;

-- ===== 3. Начисление всей группе ==============================================

-- p_mode 'add': каждому активному ученику + p_amount (минус — снять, но не ниже нуля:
--   у кого меньше, снимается остаток; у кого 0 — пропуск).
-- p_mode 'top_up_to': довести баланс каждого до p_amount (у кого уже столько — пропуск).
-- p_key — ключ формы: ключ строки журнала у ученика — 'grp:' || md5(p_key || ':' || ученик).
-- Если по этому ключу уже есть начисления в группе, пачка считается сделанной (already).
-- Отключённые ученики пропускаются.
create or replace function public.grant_stars_group(
  p_actor  uuid,
  p_group  uuid,
  p_amount integer,
  p_mode   text,
  p_note   text,
  p_key    text
) returns table (affected integer, skipped integer, total bigint, already boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_student  uuid;
  v_balance  integer;
  v_delta    integer;
  v_affected integer := 0;
  v_skipped  integer := 0;
  v_total    bigint := 0;
begin
  if p_mode is null or p_mode not in ('add', 'top_up_to') then
    raise exception 'bad_input' using errcode = 'P0001';
  end if;
  if p_amount is null or abs(p_amount) > 10000 or p_amount = 0 or (p_mode = 'top_up_to' and p_amount < 0) then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if p_key is null or char_length(p_key) not between 8 and 100 then
    raise exception 'bad_input' using errcode = 'P0001';
  end if;
  if not private.actor_teaches_group(p_actor, p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- начисления этого ведущего — по очереди, тот же замок, что берёт grant_stars. Берём его до
  -- кошельков: иначе одиночное начисление (замок, потом кошелёк) и пачка (кошелёк, потом замок)
  -- могли бы ждать друг друга.
  perform pg_advisory_xact_lock(hashtextextended('grant_stars:' || p_actor::text, 0));
  -- пачки одной группы — по очереди: так повтор той же формы точно видит первую
  perform pg_advisory_xact_lock(hashtextextended('grant_stars_group:' || p_group::text, 0));

  if exists (
       select 1 from public.profiles p
         join public.star_ledger l
           on l.user_id = p.id and l.idempotency_key = 'grp:' || md5(p_key || ':' || p.id::text)
        where p.group_id = p_group and p.role = 'student') then
    return query select 0, 0, 0::bigint, true;
    return;
  end if;

  for v_student in
    select p.id from public.profiles p
     where p.group_id = p_group and p.role = 'student' and not p.disabled
     order by p.id
  loop
    select w.balance into v_balance from public.wallets w where w.user_id = v_student for update;
    v_balance := coalesce(v_balance, 0);
    if p_mode = 'add' then
      v_delta := greatest(p_amount, -v_balance);
    else
      v_delta := greatest(p_amount - v_balance, 0);
    end if;
    if v_delta = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- все проверки и лимиты — в grant_stars (grant_limit, forbidden, …); исключение откатывает всю пачку
    perform public.grant_stars(p_actor, v_student, v_delta, p_note, 'grp:' || md5(p_key || ':' || v_student::text));
    v_affected := v_affected + 1;
    v_total := v_total + v_delta;
  end loop;

  if v_affected > 0 then
    insert into public.audit_log (actor_id, action, target_group, meta)
    values (p_actor, 'stars.grant_group', p_group,
            jsonb_build_object('mode', p_mode, 'amount', p_amount, 'note', left(p_note, 200),
                               'affected', v_affected, 'skipped', v_skipped, 'total', v_total));
  end if;
  return query select v_affected, v_skipped, v_total, false;
end $$;

-- ===== 4. Бюджет у групп, созданных до него ===================================

-- «Каждому» — как начислял триггер раньше (stars_per_student пуст → welcome_stars, после
-- миграции бюджета это 0). Учеников по плану — сколько уже есть (не меньше 1). Бюджет — 0.
update public.groups g
   set budget_stars      = coalesce(g.budget_stars, 0),
       planned_students  = coalesce(g.planned_students, least(1000, greatest(1,
                             (select count(*)::integer from public.profiles p
                               where p.group_id = g.id and p.role = 'student')))),
       stars_per_student = coalesce(g.stars_per_student, least(1000000, greatest(0, coalesce(
                             (select (s.value #>> '{}')::integer from public.settings s where s.key = 'welcome_stars'),
                             0))))
 where g.budget_stars is null or g.planned_students is null or g.stars_per_student is null;

-- ===== 5. Права: только сервер (service_role), как grant_stars ==================

revoke all on function public.group_star_stats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.group_star_stats(uuid, uuid) to service_role;
revoke all on function public.group_report_spending(uuid, uuid) from public, anon, authenticated;
grant execute on function public.group_report_spending(uuid, uuid) to service_role;
revoke all on function public.group_report_progress(uuid, uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.group_report_progress(uuid, uuid, text[], text[]) to service_role;
revoke all on function public.set_student_disabled(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_student_disabled(uuid, uuid, boolean) to service_role;
revoke all on function public.grant_stars_group(uuid, uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_stars_group(uuid, uuid, integer, text, text, text) to service_role;
