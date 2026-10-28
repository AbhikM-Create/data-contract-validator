#!/bin/sh
# Verifies supabase/schema.sql's row-level security on a throwaway local
# Postgres: two accounts and an anonymous visitor, every cross-account read,
# write and delete expected to be refused (supabase/tests/rls.sql).
#
#   sh scripts/verify-rls.sh
#
# Needs PostgreSQL's server binaries (initdb, pg_ctl). Nothing is installed or
# kept: the cluster lives in a temp directory and is removed on exit. Runs as
# the `postgres` user when started as root, because initdb refuses root.

set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)

BIN=$( (pg_config --bindir 2>/dev/null) || true)
if [ ! -x "${BIN:-}/initdb" ]; then BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1); fi
if [ ! -x "${BIN:-}/initdb" ]; then echo "PostgreSQL server binaries (initdb, pg_ctl) not found." >&2; exit 2; fi

TMP=$(mktemp -d)
cleanup() { as_db "$BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

if [ "$(id -u)" = 0 ]; then
  chown postgres "$TMP"
  as_db() { runuser -u postgres -- "$@"; }
else
  as_db() { "$@"; }
fi

as_db "$BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
as_db "$BIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses='' -p 54329" -l "$TMP/log" -w start >/dev/null

run() { as_db "$BIN/psql" -h "$TMP" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null "$@"; }
run -f "$ROOT/supabase/tests/supabase-shim.sql"
run -f "$ROOT/supabase/schema.sql" 2>"$TMP/schema.err" || { cat "$TMP/schema.err" >&2; exit 1; }

# One line per check: "ok  ..." for each pass, the failure and its reason if
# one fails. The exit status is psql's, so a failed check fails this script.
status=0
{ run -f "$ROOT/supabase/tests/rls.sql" && run -f "$ROOT/supabase/tests/orgs.sql"; } >"$TMP/out" 2>&1 || status=$?
sed -n -e 's/^.*NOTICE:  //p' -e 's/^.*ERROR:  /FAILED: /p' -e '/PASSED/p' "$TMP/out" | sed 's/^FAILED: FAILED: /FAILED: /'
exit $status
