import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import async_session_factory
from app.deps import get_current_customer, get_current_staff, get_optional_customer
from app.main import app
from app.models import Customer, CustomerStatus, CustomerType, Staff, StaffRole
from app.security import get_current_auth_user

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


@pytest.fixture
async def fake_customer() -> AsyncGenerator[Customer, None]:
    """A real `customers` row (with a matching auth.users row, same
    reasoning as fake_staff -- FKs like orders.customer_id need it to
    actually exist), used for testing the signed-in storefront paths."""
    customer_id = uuid.uuid4()
    auth_user_id = uuid.uuid4()
    email = f"test-customer-{customer_id.hex[:8]}@example.com"

    async with async_session_factory() as session:
        await session.execute(
            text("insert into auth.users (id, email) values (:id, :email)"),
            {"id": auth_user_id, "email": email},
        )
        customer = Customer(
            id=customer_id,
            auth_user_id=auth_user_id,
            full_name="Test Customer",
            email=email,
            customer_type=CustomerType.retail,
            status=CustomerStatus.approved,
        )
        session.add(customer)
        await session.commit()

    yield customer

    async with async_session_factory() as session:
        # orders.customer_id is ON DELETE RESTRICT (same reasoning as
        # stock_movements.performed_by on fake_staff below) -- a test that
        # checks out as this customer would otherwise leave the FK
        # blocking cleanup. order_items/order_status_history cascade from
        # orders, and addresses cascade from customers, so only orders
        # needs an explicit delete here.
        await session.execute(text("delete from orders where customer_id = :id"), {"id": customer_id})
        await session.execute(text("delete from customers where id = :id"), {"id": customer_id})
        await session.execute(text("delete from auth.users where id = :id"), {"id": auth_user_id})
        await session.commit()


@pytest.fixture
def customer_client(fake_customer: Customer):
    """Like `client`, but signed in as a storefront customer instead of
    staff -- overrides both get_current_customer and get_optional_customer
    since checkout depends on the latter (guest-or-signed-in), while
    account/order-history routes depend on the former (signed-in only)."""
    app.dependency_overrides[get_current_customer] = lambda: fake_customer
    app.dependency_overrides[get_optional_customer] = lambda: fake_customer
    try:
        yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    finally:
        app.dependency_overrides.pop(get_current_customer, None)
        app.dependency_overrides.pop(get_optional_customer, None)


@pytest.fixture
async def fake_auth_identity() -> AsyncGenerator[dict, None]:
    """A real auth.users row with *no* matching customers row -- the state
    a shopper is in right after Supabase Auth sign-up, before hitting
    POST /customers/register. Yields the decoded-JWT-shaped dict
    get_current_auth_user would normally produce."""
    user_id = uuid.uuid4()
    email = f"test-signup-{user_id.hex[:8]}@example.com"

    async with async_session_factory() as session:
        await session.execute(
            text("insert into auth.users (id, email) values (:id, :email)"),
            {"id": user_id, "email": email},
        )
        await session.commit()

    yield {"sub": str(user_id), "email": email}

    async with async_session_factory() as session:
        await session.execute(text("delete from customers where auth_user_id = :id"), {"id": user_id})
        await session.execute(text("delete from auth.users where id = :id"), {"id": user_id})
        await session.commit()


@pytest.fixture
def signup_client(fake_auth_identity: dict):
    """For exercising POST /customers/register itself, which depends on
    get_current_auth_user directly (there's no customers row -- and so no
    get_current_customer -- until that call succeeds)."""
    app.dependency_overrides[get_current_auth_user] = lambda: fake_auth_identity
    try:
        yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    finally:
        app.dependency_overrides.pop(get_current_auth_user, None)


@pytest.fixture(autouse=True)
def _require_database_url():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; skipping tests that hit the database")
