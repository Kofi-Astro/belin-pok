from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Supabase's session-mode pooler (port 5432) supports prepared statements
# fine. If this is ever pointed at the transaction-mode pooler (port 6543)
# ("pgbouncer" transaction pooling), add `statement_cache_size=0` to
# connect_args -- asyncpg's prepared statement cache is incompatible with
# transaction-mode pooling.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, echo=False)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
