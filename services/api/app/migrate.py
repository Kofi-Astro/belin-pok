"""Applies migrations/*.sql to DATABASE_URL, in filename order, once each.

    python -m app.migrate

Runs automatically before every Railway deploy (see railway.json's
preDeployCommand), so a deploy whose code needs a new column can't go
live before the column exists -- if a migration fails, the deploy stops
and the previous version keeps serving.

Deliberately tiny rather than Alembic: migrations here are hand-written
SQL (triggers, partial indexes, CHECK constraints) that an ORM-diffing
tool wouldn't generate anyway, so all that's needed is "run each file
once, in order, and remember which ran".

- Applied filenames are recorded in public.schema_migrations.
- Each file runs in its own transaction together with its bookkeeping
  row, so a failing file leaves nothing half-applied and is retried in
  full next time.
- A Postgres advisory lock serializes concurrent runs (e.g. two deploys
  racing), so the same file can never be applied twice.
- Files are never edited after they've reached a live database -- a fix
  is a new file. (The one exception was the move off Supabase, when every
  database was being created from scratch anyway.)
"""

import asyncio
import sys
from pathlib import Path

import asyncpg

from app.config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# Arbitrary, but fixed: every run of this script contends for the same lock.
_ADVISORY_LOCK_KEY = 4_820_117


def _plain_dsn(database_url: str) -> str:
    """DATABASE_URL carries SQLAlchemy's driver prefix
    (postgresql+asyncpg://); asyncpg itself wants plain postgresql://."""
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def apply_migrations(database_url: str, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Applies every not-yet-applied migration; returns the filenames it
    applied (empty when already up to date)."""
    conn = await asyncpg.connect(_plain_dsn(database_url))
    try:
        await conn.execute("select pg_advisory_lock($1)", _ADVISORY_LOCK_KEY)
        await conn.execute(
            """
            create table if not exists public.schema_migrations (
              filename text primary key,
              applied_at timestamptz not null default now()
            )
            """
        )
        already_applied = {row["filename"] for row in await conn.fetch("select filename from public.schema_migrations")}

        applied_now = []
        for path in sorted(migrations_dir.glob("*.sql")):
            if path.name in already_applied:
                continue
            async with conn.transaction():
                # No bind parameters, so asyncpg uses the simple query
                # protocol -- which is what allows a file to contain many
                # statements (and $$-quoted function bodies) in one call.
                await conn.execute(path.read_text())
                await conn.execute("insert into public.schema_migrations (filename) values ($1)", path.name)
            applied_now.append(path.name)
        return applied_now
    finally:
        # Released explicitly rather than relying on disconnect, so a
        # long-lived connection reusing this function wouldn't hold it.
        await conn.execute("select pg_advisory_unlock($1)", _ADVISORY_LOCK_KEY)
        await conn.close()


def main() -> None:
    applied = asyncio.run(apply_migrations(get_settings().database_url))
    if applied:
        for name in applied:
            print(f"applied {name}")
    else:
        print("database is up to date")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Any failure: report it and exit non-zero, which stops the deploy.
        print(f"migration failed: {exc}", file=sys.stderr)
        sys.exit(1)
