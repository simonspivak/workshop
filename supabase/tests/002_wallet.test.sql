-- Звёзды: стартовый баланс, списание, идемпотентность, возврат, лимиты, бонус за тест,
-- неизменяемость журнала. Запуск: `supabase test db` или `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

-- ---------- данные ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'teacher1@example.test'),
  ('a0000000-0000-4000-8000-000000000003', 'teacher2@example.test');
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'teacher', age_band = 'adult'
 where id in ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003');
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000001', 'g1', 'Группа 1', 'a0000000-0000-4000-8000-000000000002', 1000),
  ('b0000000-0000-4000-8000-000000000002', 'g2', 'Группа 2', 'a0000000-0000-4000-8000-000000000003', 1000);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-00000000000a', 'g1-anna@students.example.test',
   '{"login": "g1-anna", "nickname": "Анна", "group_id": "b0000000-0000-4000-8000-000000000001", "age_band": "16_17"}'),
  ('c0000000-0000-4000-8000-00000000000b', 'g1-boris@students.example.test',
   '{"login": "g1-boris", "nickname": "Борис", "group_id": "b0000000-0000-4000-8000-000000000001"}'),
  ('c0000000-0000-4000-8000-00000000000c', 'g2-vera@students.example.test',
   '{"login": "g2-vera", "nickname": "Вера", "group_id": "b0000000-0000-4000-8000-000000000002"}');

-- ---------- профиль и стартовые звёзды (триггер на auth.users) ----------
select is((select login from public.profiles where id = 'c0000000-0000-4000-8000-00000000000a'), 'g1-anna',
  'профиль создан из app_metadata');
select is((select age_band::text from public.profiles where id = 'c0000000-0000-4000-8000-00000000000a'), '16_17',
  'возраст из app_metadata');
select is((select age_band::text from public.profiles where id = 'c0000000-0000-4000-8000-00000000000b'), 'u16',
  'возраст по умолчанию — u16');
select is((select role::text from public.profiles where id = 'c0000000-0000-4000-8000-00000000000b'), 'student',
  'роль всегда student');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-00000000000a'), 1000,
  'новому ученику 1000 звёзд');
select is((select count(*)::int from public.star_ledger
            where user_id = 'c0000000-0000-4000-8000-00000000000a' and reason = 'welcome'), 1,
  'стартовые звёзды записаны в журнал');
select is((select balance from public.wallets where user_id = 'a0000000-0000-4000-8000-000000000002'), 0,
  'учителю стартовые звёзды не начисляются');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-0000000000ff', 'sneaky@example.test', '{"role": "admin", "group_id": "b0000000-0000-4000-8000-000000000001"}');
select is((select role::text || ':' || coalesce(group_id::text, '-') from public.profiles
            where id = 'c0000000-0000-4000-8000-0000000000ff'), 'student:-',
  'user_metadata не влияет на роль и группу');

-- ---------- списание и идемпотентность ----------
set local role service_role;
select is((select balance from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
            'bytedance/seedance-2-mini', 25, 'w-video-0001', '{"duration": 5}', 'латке на сковороде')), 975,
  'списание 25 звёзд');
select is((select reused from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
            'bytedance/seedance-2-mini', 25, 'w-video-0001')), true, 'повтор с тем же ключом возвращает ту же задачу');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-00000000000a'), 975,
  'второго списания нет');
select is((select count(*)::int from public.jobs where user_id = 'c0000000-0000-4000-8000-00000000000a'), 1,
  'задача одна');
select is((select group_id from public.jobs where idempotency_key = 'w-video-0001'),
  'b0000000-0000-4000-8000-000000000001'::uuid, 'в задаче запомнена группа');

-- ---------- возврат ----------
select is((select refunded from public.refund_job((select id from public.jobs where idempotency_key = 'w-video-0001'),
            'kie: fail')), 25, 'возврат 25 звёзд');
select is((select refunded from public.refund_job((select id from public.jobs where idempotency_key = 'w-video-0001'),
            'again')), 0, 'повторный возврат ничего не делает');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-00000000000a'), 1000,
  'баланс восстановлен');
select is((select status::text from public.jobs where idempotency_key = 'w-video-0001'), 'failed', 'задача закрыта');

-- ---------- жизненный цикл задачи ----------
select job_id from public.create_job('c0000000-0000-4000-8000-00000000000a', 'image',
  'flux-3/klein-text-to-image', 2, 'w-image-0001');
select ok(public.mark_job_submitted((select id from public.jobs where idempotency_key = 'w-image-0001'), 'task-1'),
  'задача отправлена в шлюз');
select ok(not public.mark_job_submitted((select id from public.jobs where idempotency_key = 'w-image-0001'), 'task-2'),
  'повторная отправка не перезаписывает taskId');
update public.jobs set last_polled_at = now() - interval '10 seconds' where idempotency_key = 'w-image-0001';
select ok(public.claim_job_poll((select id from public.jobs where idempotency_key = 'w-image-0001')),
  'можно спросить статус');
select ok(not public.claim_job_poll((select id from public.jobs where idempotency_key = 'w-image-0001')),
  'не чаще раза в 5 секунд');
select ok(public.begin_job_storing((select id from public.jobs where idempotency_key = 'w-image-0001')),
  'первый обработчик копирует результат');
select ok(not public.begin_job_storing((select id from public.jobs where idempotency_key = 'w-image-0001')),
  'второй обработчик — нет');
select ok(public.complete_job((select id from public.jobs where idempotency_key = 'w-image-0001'),
  'c0000000-0000-4000-8000-00000000000a/x.jpg', '{}', 'image/jpeg'), 'задача завершена');
select is((select refunded from public.refund_job((select id from public.jobs where idempotency_key = 'w-image-0001'),
            'late fail')), 0, 'готовую задачу вернуть нельзя');
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-00000000000a'), 998,
  'баланс 998');

-- ---------- отказы ----------
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'lipsync',
                    'kling/ai-avatar-standard', 1500, 'w-big-00001') $$, 'P0001', 'insufficient_stars',
  'не хватает звёзд');
select is((select count(*)::int from public.jobs where idempotency_key = 'w-big-00001'), 0, 'задача не создана');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
                    'bytedance/seedance-2-mini', 0, 'w-free-00001') $$, 'P0001', 'forbidden',
  'ученику нельзя бесплатно');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
                    'bytedance/seedance-2-5', 25, 'w-staff-0001') $$, 'P0001', 'forbidden',
  'ученику нельзя модель только для учителя');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
                    'some/unknown-model', 25, 'w-unkn-00001') $$, 'P0001', 'unknown_model', 'модель не из прайса');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'video',
                    'bytedance/seedance-2-mini', -5, 'w-neg-000001') $$, 'P0001', 'bad_amount',
  'отрицательная цена');
select is((select balance from public.create_job('a0000000-0000-4000-8000-000000000002', 'video',
            'bytedance/seedance-2-5', 0, 'w-teach-0001')), 0, 'учитель генерирует бесплатно');

-- баланс не уходит в минус даже у владельца таблиц
reset role;
select throws_ok($$ update public.wallets set balance = -1 where user_id = 'c0000000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'check (balance >= 0)');
set local role service_role;
select throws_ok($$ update public.wallets set balance = 5 $$, '42501', null, 'сервер не меняет баланс напрямую');
select throws_ok($$ insert into public.star_ledger (user_id, delta, reason, balance_after)
                    values ('c0000000-0000-4000-8000-00000000000a', 5, 'grant', 1003) $$, '42501', null,
  'сервер не пишет в журнал напрямую');

-- ---------- начисление учителем ----------
select is(public.grant_stars('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a',
  100, 'за проект', 'w-grant-0001'), 1098, 'учитель начислил 100');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a',
  100, 'за проект', 'w-grant-0001'), 1098, 'повтор начисления с тем же ключом не начисляет');
select throws_ok($$ select public.grant_stars('a0000000-0000-4000-8000-000000000003',
                    'c0000000-0000-4000-8000-00000000000a', 100) $$, 'P0001', 'forbidden',
  'учитель чужой группы не начисляет');
select throws_ok($$ select public.grant_stars('c0000000-0000-4000-8000-00000000000b',
                    'c0000000-0000-4000-8000-00000000000a', 100) $$, 'P0001', 'forbidden', 'ученик не начисляет');
select throws_ok($$ select public.grant_stars('a0000000-0000-4000-8000-000000000002',
                    'c0000000-0000-4000-8000-00000000000a', -5000) $$, 'P0001', 'insufficient_stars',
  'снять больше баланса нельзя');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a', -98),
  1000, 'учитель снял 98');
select is(public.grant_stars('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 50),
  1050, 'админ начисляет любому');
select is((select count(*)::int from public.audit_log where action = 'stars.grant'), 3, 'начисления в журнале аудита');

-- ---------- пауза группы ----------
reset role;
update public.groups set paused = true where id = 'b0000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000b', 'image',
                    'flux-3/klein-text-to-image', 2, 'w-pause-0001') $$, 'P0001', 'group_paused', 'группа на паузе');
select throws_ok($$ select * from public.spend_stars('c0000000-0000-4000-8000-00000000000b', 1, 'bot_reply',
                    'w-bot-pause-01') $$, 'P0001', 'group_paused', 'бот ученика на паузе молчит');
select is((select reused from public.create_job('c0000000-0000-4000-8000-00000000000b', 'montage',
            'platform/auto-montage', 0, 'w-mont-00001')), false, 'бесплатный монтаж на паузе можно сохранить');
reset role;
update public.groups set paused = false where id = 'b0000000-0000-4000-8000-000000000001';

-- ---------- дневной лимит группы ----------
update public.groups set daily_cap = 3 + (
  select coalesce(sum(-l.delta), 0) from public.star_ledger l join public.profiles p on p.id = l.user_id
   where p.group_id = 'b0000000-0000-4000-8000-000000000001' and l.reason in ('debit', 'refund'))
 where id = 'b0000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select reused from public.create_job('c0000000-0000-4000-8000-00000000000b', 'image',
            'flux-3/klein-text-to-image', 2, 'w-cap-000001')), false, 'в пределах дневного лимита');
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000a', 'image',
                    'flux-3/klein-text-to-image', 2, 'w-cap-000002') $$, 'P0001', 'daily_cap',
  'дневной лимит группы исчерпан');

-- ---------- глобальный рубильник ----------
reset role;
update public.settings set value = 'false' where key = 'generation_enabled';
set local role service_role;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000c', 'image',
                    'flux-3/klein-text-to-image', 2, 'w-kill-00001') $$, 'P0001', 'generation_disabled',
  'генерации выключены глобально');
reset role;
update public.settings set value = 'true' where key = 'generation_enabled';
set local role service_role;

-- ---------- не больше 5 задач в работе ----------
select j.job_id from generate_series(10001, 10005) as n,
  lateral public.create_job('c0000000-0000-4000-8000-00000000000c', 'image', 'flux-3/klein-text-to-image', 2,
                            'w-many-' || n) as j;
select throws_ok($$ select * from public.create_job('c0000000-0000-4000-8000-00000000000c', 'image',
                    'flux-3/klein-text-to-image', 2, 'w-many-10006') $$, 'P0001', 'too_many_jobs',
  'шестая задача в работе не создаётся');

-- ---------- ответ бота ----------
select is((select charged from public.spend_stars('c0000000-0000-4000-8000-00000000000c', 1, 'bot_reply',
            'w-bot-000001', 'msg-1')), true, 'ответ бота списал 1 звезду');
select is((select charged from public.spend_stars('c0000000-0000-4000-8000-00000000000c', 1, 'bot_reply',
            'w-bot-000001', 'msg-1')), false, 'повтор того же сообщения не списывает');
select throws_ok($$ select * from public.spend_stars('c0000000-0000-4000-8000-00000000000c', 1, 'grant',
                    'w-bot-000002') $$, 'P0001', 'bad_reason', 'spend_stars не начисляет');

-- ---------- тест урока ----------
select is((select bonus from public.record_quiz_attempt('c0000000-0000-4000-8000-00000000000a', 'lesson-1',
            '[1, 0, 2]', 9, 10, 20)), 20, 'бонус за тест начислен');
select is((select already_done from public.record_quiz_attempt('c0000000-0000-4000-8000-00000000000a', 'lesson-1',
            '[0, 0, 0]', 2, 10, 20)), true, 'вторая попытка не засчитывается');
select is((select count(*)::int from public.star_ledger
            where user_id = 'c0000000-0000-4000-8000-00000000000a' and reason = 'quiz_bonus'), 1, 'бонус один раз');

-- ---------- журнал неизменяем, баланс сходится с журналом ----------
reset role;
select throws_ok($$ update public.star_ledger set delta = 999 $$, 'P0001', 'star_ledger is append-only',
  'журнал нельзя менять');
select throws_ok($$ delete from public.star_ledger $$, 'P0001', 'star_ledger is append-only', 'журнал нельзя удалять');
select is((select count(*)::int from public.wallets w
            where w.balance <> coalesce((select sum(l.delta) from public.star_ledger l where l.user_id = w.user_id), 0)),
  0, 'у всех баланс равен сумме журнала');

-- ---------- удаление пользователя и триггер от имени Auth ----------
select lives_ok($$ delete from auth.users where id = 'c0000000-0000-4000-8000-00000000000c' $$,
  'удаление пользователя каскадом проходит через журнал');
select is((select count(*)::int from public.star_ledger where user_id = 'c0000000-0000-4000-8000-00000000000c'), 0,
  'журнал удалённого пользователя удалён');
set local role supabase_auth_admin;
select lives_ok($$ insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-00000000000d', 'g2-gleb@students.example.test',
   '{"login": "g2-gleb", "nickname": "Глеб", "group_id": "b0000000-0000-4000-8000-000000000002"}') $$,
  'Auth создаёт пользователя без прав на схему private');
reset role;
select is((select balance from public.wallets where user_id = 'c0000000-0000-4000-8000-00000000000d'), 1000,
  'триггер сработал и от имени Auth');

select * from finish();
rollback;
