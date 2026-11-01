#!/usr/bin/env bash
# Локальная проверка миграций и SQL-тестов без Docker и без Supabase CLI.
#
# Поднимает временный кластер PostgreSQL, накатывает заглушку Supabase
# (scripts/db-test/supabase-stub.sql), все миграции из supabase/migrations
# и прогоняет supabase/tests/*.test.sql. Если расширения pgtap нет, подключается
# минимальная замена (scripts/db-test/pgtap-shim.sql).
#
#   scripts/db-test/run.sh
#
# Переменные:
#   PGBIN        каталог с initdb/pg_ctl (по умолчанию /usr/lib/postgresql/16/bin или из PATH)
#   DB_TEST_DIR  где создать кластер (по умолчанию новый каталог в $TMPDIR); удаляется после прогона
#   DB_TEST_PORT порт (по умолчанию 55432)
#   KEEP_DB=1    не останавливать кластер после прогона (для отладки)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/scripts/db-test"
PORT="${DB_TEST_PORT:-55432}"

if [[ -z "${PGBIN:-}" ]]; then
  if [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then PGBIN=/usr/lib/postgresql/16/bin
  else PGBIN="$(dirname "$(command -v initdb)")"; fi
fi

WORK="${DB_TEST_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/workshop-db-test.XXXXXX")}"
mkdir -p "$WORK"

# PostgreSQL нельзя запускать от root: тогда сервер работает от пользователя postgres
AS=()
if [[ "$(id -u)" == "0" ]]; then
  chown postgres "$WORK"
  AS=(runuser -u postgres --)
fi

cleanup() {
  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    "${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
  else
    echo "Кластер оставлен: $WORK (порт $PORT)"
  fi
}
trap cleanup EXIT

"${AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -w \
  -o "-p $PORT -k $WORK -c listen_addresses=''" start >/dev/null

PSQL=(psql -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c 'alter database postgres set search_path = "$user", public, extensions'
"${PSQL[@]}" -f "$HERE/supabase-stub.sql" >/dev/null

if [[ -f "$("${AS[@]}" "$PGBIN/pg_config" --sharedir 2>/dev/null || pg_config --sharedir)/extension/pgtap.control" ]]; then
  SHIM=0
  echo "pgTAP: расширение"
else
  SHIM=1
  "${PSQL[@]}" -f "$HERE/pgtap-shim.sql" >/dev/null
  echo "pgTAP: локальная замена (scripts/db-test/pgtap-shim.sql)"
fi

for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "миграция: $(basename "$m")"
  "${PSQL[@]}" -f "$m" >/dev/null
done

failed=0
for t in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$t")"
  if [[ "$SHIM" == "1" ]]; then
    out="$(sed -E '/create extension .*pgtap/Id' "$t" | "${PSQL[@]}" -t -A -f - 2>&1)" || { failed=1; }
  else
    out="$("${PSQL[@]}" -t -A -f "$t" 2>&1)" || { failed=1; }
  fi
  total="$(grep -cE '^(not )?ok [0-9]+' <<<"$out" || true)"
  bad="$(grep -cE '^not ok |^# Looks like|ERROR' <<<"$out" || true)"
  if [[ "$bad" != "0" ]]; then
    failed=1
    echo "FAIL $name ($total проверок)"
    grep -E '^not ok |^# |ERROR|psql:' <<<"$out" | sed 's/^/    /'
  else
    echo "ok   $name ($total проверок)"
  fi
done

if [[ "$failed" != "0" ]]; then
  echo "Есть ошибки. Лог сервера: $WORK/server.log"
  exit 1
fi
echo "Все SQL-тесты прошли."
