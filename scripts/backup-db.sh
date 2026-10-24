#!/bin/sh
# Takes a full backup of the production database and saves it on this
# computer, in ~/belpok-backups (outside the repo: it holds customer data).
#
# Needs the Railway CLI, signed in and linked to the project (`railway
# login`, `railway link`). The database is only reachable inside Railway,
# so the dump runs in the Postgres container over `railway ssh`; it's
# compressed and base64-encoded there so the bytes survive the SSH session
# intact, then decoded here.
#
# Restore into a database (e.g. a fresh local one to inspect it):
#   createdb belpok_restore && gunzip -c <file> | psql -d belpok_restore
#
# Railway's own scheduled backups need a Pro workspace; until then, run
# this regularly (say weekly, and before any risky change).
set -eu

dir="$HOME/belpok-backups"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/belpok-$(date +%Y%m%d-%H%M).sql.gz"

railway ssh --service Postgres -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip | base64' \
  | grep -v '^Using SSH key' | base64 -d > "$file"
chmod 600 "$file"

# A dump that stopped part-way has no closing marker -- don't keep it.
if ! gunzip -c "$file" | tail -5 | grep -q 'unrestrict\|PostgreSQL database dump complete'; then
  rm -f "$file"
  echo "Backup failed: the dump was incomplete." >&2
  exit 1
fi

tables=$(gunzip -c "$file" | grep -c '^COPY public\.')
echo "Saved $file ($tables tables, $(du -h "$file" | cut -f1))"
