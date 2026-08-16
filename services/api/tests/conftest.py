import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import async_session_factory
from app.deps import get_current_staff
from app.main import app
from app.models import Staff, StaffRole

# Tests never verify real Supabase JWTs (that needs a live Supabase project
# or a self-hosted GoTrue instance) -- instead they override the
# get_current_staff dependency directly, which is the standard FastAPI way
# to unit/integration-test authenticated routes. What's still exercised for
# real: SQLAlchemy models, Pydantic validation, role checks, and the actual
# Postgres schema/constraints/triggers from supabase/migrations/, against
# the database at DATABASE_URL (see tests/ci_bootstrap.sql + the CI
# workflow for how that database is prepared).
#
# fake_staff is a *real* row in auth.users + staff, not just an in-memory
# object -- routes write staff.id into FKs like products.created_by and
# stock_movements.performed_by, so those inserts need a row that actually
# exists.


@pytest.fixture
async def fake_staff() -> AsyncGenerator[Staff, None]:
    staff_id = uuid.uuid4()
    email = f"test-owner-{staff_id.hex[:8]}@example.com"

    async with async_session_factory() as session:
        await session.execute(
            text("insert into auth.users (id, email) values (:id, :email)"),
            {"id": staff_id, "email": email},
        )
        staff = Staff(id=staff_id, email=email, full_name="Test Owner", role=StaffRole.owner, is_active=True)
        session.add(staff)
        await session.commit()

    yield staff

    async with async_session_factory() as session:
        # stock_movements.performed_by is ON DELETE RESTRICT (an audit
        # trail shouldn't silently lose who did what) -- tests that log a
        # movement as this staff member would otherwise leave the FK
        # blocking staff/auth.users cleanup below.
        await session.execute(text("delete from stock_movements where performed_by = :id"), {"id": staff_id})
        await session.execute(text("delete from staff where id = :id"), {"id": staff_id})
        await session.execute(text("delete from auth.users where id = :id"), {"id": staff_id})
        await session.commit()


@pytest.fixture
def client(fake_staff: Staff):
    app.dependency_overrides[get_current_staff] = lambda: fake_staff
    try:
        yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    finally:
        app.dependency_overrides.pop(get_current_staff, None)


@pytest.fixture(autouse=True)
def _require_database_url():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; skipping tests that hit the database")
