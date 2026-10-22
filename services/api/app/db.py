from collections.abc import AsyncGenerator
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Railway's Postgres is a direct connection (no PgBouncer in front), so
# asyncpg's prepared-statement cache works as-is. If a transaction-mode
# pooler is ever put in front of it, add `statement_cache_size=0` to
# connect_args -- that cache is incompatible with transaction pooling.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, echo=False)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    # Every timestamp column in migrations/ is `timestamptz`, but
    # SQLAlchemy's default mapping for a bare `datetime` annotation is a
    # naive DateTime -- asyncpg then rejects any tz-aware Python datetime
    # (e.g. `datetime.now(UTC)`) bound to it with a confusing "can't
    # subtract offset-naive and offset-aware datetimes" error. This makes
    # every `Mapped[datetime]`/`Mapped[datetime | None]` column
    # timezone-aware by default instead of needing that spelled out
    # per-column.
    type_annotation_map = {datetime: DateTime(timezone=True)}


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
