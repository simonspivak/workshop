-- Вход: попытка с IP занимается до проверки пароля и возвращается при успехе;
-- поиск аккаунта ведущего по адресу входа (миграция 20261116150000_login_limits.sql).
-- Запуск: `supabase test db` или локально `scripts/db-test/run.sh`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ---------- данные: ведущий, админ, ученица ----------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000081', 'teacher81@example.test'),
  ('a0000000-0000-4000-8000-000000000082', 'admin82@example.test');
update public.profiles set role = 'teacher', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000081';
update public.profiles set role = 'admin', age_band = 'adult' where id = 'a0000000-0000-4000-8000-000000000082';
insert into public.groups (id, code, title, teacher_id, stars_per_student) values
  ('b0000000-0000-4000-8000-000000000081', 'g81', 'Группа 81', 'a0000000-0000-4000-8000-000000000081', 100);
insert into auth.users (id, email, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000081', 'g81-ira@students.example.test',
   '{"login": "g81-ira", "nickname": "Ира", "group_id": "b0000000-0000-4000-8000-000000000081"}');

set local role service_role;

-- ---------- занять и вернуть попытку ----------
create temporary table t_hits (n int, id bigint) on commit drop;
insert into t_hits select 1, public.rate_limit_take('login-ip:test-0001', 2, 600);
select ok((select id from t_hits where n = 1) is not null, 'первая попытка занята, есть id');
insert into t_hits select 2, public.rate_limit_take('login-ip:test-0001', 2, 600);
select ok((select id from t_hits where n = 2) is not null, 'вторая занята');
select is(public.rate_limit_take('login-ip:test-0001', 2, 600), null::bigint, 'третья — лимит, null');
select is(public.rate_limit_hit('login-ip:test-0001', 2, 600), false, 'rate_limit_hit видит те же попытки');

-- удачный вход возвращает свою попытку: место снова есть
select is(public.rate_limit_refund('login-ip:test-0001', (select id from t_hits where n = 2)), true, 'возврат своей попытки');
select is(public.rate_limit_refund('login-ip:test-0001', (select id from t_hits where n = 2)), false,
  'повторный возврат той же попытки ничего не удаляет');
insert into t_hits select 3, public.rate_limit_take('login-ip:test-0001', 2, 600);
select ok((select id from t_hits where n = 3) is not null, 'после возврата попытка снова есть');
select is(public.rate_limit_take('login-ip:test-0001', 2, 600), null::bigint, 'а сверх лимита — нет');

-- чужой ключ: id существует, но ключ другой — не удаляется
insert into t_hits select 4, public.rate_limit_take('login-ip:test-0002', 5, 600);
select is(public.rate_limit_refund('login-ip:test-0001', (select id from t_hits where n = 4)), false,
  'попытку другого ключа вернуть нельзя');
reset role;
select is((select count(*)::int from private.rate_limit_hits where key = 'login-ip:test-0002'), 1,
  'попытка другого ключа на месте');
set local role service_role;

-- 50 успешных входов подряд (занять + вернуть) не тратят лимит в 3 попытки
do $$
declare v bigint;
begin
  for i in 1..50 loop
    v := public.rate_limit_take('login-ip:test-0003', 3, 600);
    if v is null then raise exception 'limit hit on success %', i; end if;
    perform public.rate_limit_refund('login-ip:test-0003', v);
  end loop;
end $$;
reset role;
select is((select count(*)::int from private.rate_limit_hits where key = 'login-ip:test-0003'), 0,
  '50 удачных входов не оставили ни одной попытки');
set local role service_role;
select is(public.rate_limit_take('login-ip:test-0003', 3, 600) is not null, true, 'неудача после них засчитывается');

-- старые попытки вне окна не считаются
reset role;
insert into private.rate_limit_hits (key, hit_at) values
  ('login-ip:test-0004', now() - interval '20 minutes'), ('login-ip:test-0004', now() - interval '20 minutes');
set local role service_role;
select ok(public.rate_limit_take('login-ip:test-0004', 2, 900) is not null, 'попытки старше окна не мешают');

select throws_ok($$ select public.rate_limit_take('short', 2, 600) $$, 'P0001', 'bad_rate_limit', 'короткий ключ отклонён');
select throws_ok($$ select public.rate_limit_take('login-ip:test-0005', 0, 600) $$, 'P0001', 'bad_rate_limit',
  'нулевой лимит отклонён');

-- ---------- аккаунт ведущего по адресу ----------
select is(public.staff_id_by_email('teacher81@example.test'), 'a0000000-0000-4000-8000-000000000081'::uuid, 'ведущий найден');
select is(public.staff_id_by_email('Admin82@Example.test'), 'a0000000-0000-4000-8000-000000000082'::uuid,
  'админ найден без учёта регистра');
select is(public.staff_id_by_email('g81-ira@students.example.test'), null::uuid, 'ученица — не ведущий');
select is(public.staff_id_by_email('nobody@example.test'), null::uuid, 'несуществующий адрес — null');

-- ---------- клиенты ничего из этого не вызывают ----------
reset role;
select ok(not has_function_privilege('authenticated', 'public.rate_limit_take(text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.rate_limit_take(text, integer, integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.rate_limit_refund(text, bigint)', 'execute')
      and not has_function_privilege('anon', 'public.rate_limit_refund(text, bigint)', 'execute'),
  'клиент не занимает и не возвращает попытки');
select ok(not has_function_privilege('authenticated', 'public.staff_id_by_email(text)', 'execute')
      and not has_function_privilege('anon', 'public.staff_id_by_email(text)', 'execute'),
  'клиент не ищет аккаунты ведущих по адресу');

select * from finish();
rollback;
