-- Минимальная замена pgTAP для локального прогона, когда расширение pgtap не установлено.
-- Реализует только то, что используют supabase/tests/*.test.sql:
--   plan(int), ok(bool, text), is(any, any, text), isnt(any, any, text),
--   throws_ok(sql, errcode, errmsg, text), lives_ok(sql, text), finish().
-- Вывод — TAP, как у pgTAP. В Supabase (`supabase test db`) используется настоящий pgTAP.

create schema if not exists extensions;

create or replace function extensions._tap_emit(passed boolean, descr text, diag text default null)
returns text language plpgsql as $$
declare
  n integer := coalesce(nullif(current_setting('tap.run', true), ''), '0')::integer + 1;
  f integer := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::integer;
begin
  perform set_config('tap.run', n::text, false);
  if not passed then
    perform set_config('tap.failed', (f + 1)::text, false);
  end if;
  return (case when passed then 'ok ' else 'not ok ' end) || n
         || coalesce(' - ' || descr, '')
         || case when not passed and diag is not null
                 then E'\n# ' || replace(diag, E'\n', E'\n# ') else '' end;
end $$;

create or replace function extensions.plan(n integer) returns text
language plpgsql as $$
begin
  perform set_config('tap.planned', n::text, false);
  perform set_config('tap.run', '0', false);
  perform set_config('tap.failed', '0', false);
  return '1..' || n;
end $$;

create or replace function extensions.ok(passed boolean, descr text default null) returns text
language sql as $$
  select extensions._tap_emit(coalesce(passed, false), descr)
$$;

create or replace function extensions."is"(have anyelement, want anyelement, descr text default null)
returns text language sql as $$
  select extensions._tap_emit(have is not distinct from want, descr,
    '        have: ' || coalesce(have::text, 'NULL') || E'\n        want: ' || coalesce(want::text, 'NULL'))
$$;

create or replace function extensions.isnt(have anyelement, want anyelement, descr text default null)
returns text language sql as $$
  select extensions._tap_emit(have is distinct from want, descr,
    '        have: ' || coalesce(have::text, 'NULL') || E'\n        want: anything else')
$$;

create or replace function extensions.throws_ok(code text, errcode text, errmsg text, descr text default null)
returns text language plpgsql as $$
begin
  execute code;
  return extensions._tap_emit(false, descr, 'no exception was thrown');
exception when others then
  return extensions._tap_emit(
    (errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg),
    descr,
    '      caught: ' || sqlstate || ': ' || sqlerrm
      || E'\n      wanted: ' || coalesce(errcode, '*') || ': ' || coalesce(errmsg, '*'));
end $$;

create or replace function extensions.lives_ok(code text, descr text default null)
returns text language plpgsql as $$
begin
  execute code;
  return extensions._tap_emit(true, descr);
exception when others then
  return extensions._tap_emit(false, descr, '      died: ' || sqlstate || ': ' || sqlerrm);
end $$;

create or replace function extensions.finish() returns setof text
language plpgsql as $$
declare
  planned integer := coalesce(nullif(current_setting('tap.planned', true), ''), '0')::integer;
  ran     integer := coalesce(nullif(current_setting('tap.run', true), ''), '0')::integer;
  failed  integer := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::integer;
begin
  if ran <> planned then
    return next '# Looks like you planned ' || planned || ' tests but ran ' || ran;
  end if;
  if failed > 0 then
    return next '# Looks like you failed ' || failed || ' test(s) of ' || ran;
  end if;
  return;
end $$;

grant execute on all functions in schema extensions to public;
