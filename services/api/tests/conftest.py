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
        # stock_movements.performed_by and pos_sales.staff_id are both ON
        # DELETE RESTRICT (an audit trail shouldn't silently lose who did
        # what) -- tests that log a movement or ring up a sale as this
        # staff member would otherwise leave one of those FKs blocking
        # staff/auth.users cleanup below. pos_sale_items/pos_sale_payments
        # cascade from pos_sales, so deleting it is enough.
        await session.execute(text("delete from stock_movements where performed_by = :id"), {"id": staff_id})
        await session.execute(text("delete from pos_sales where staff_id = :id"), {"id": staff_id})
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


@pytest.fixture
def fresh_client():
    """A factory for plain AsyncClients with no dependency overrides of
    their own. Which identity (if any) a request through one resolves to
    depends entirely on what's registered in app.dependency_overrides at
    call time (set by whichever of client/customer_client/etc. the test
    is also using) -- not on anything about the instance itself.
    httpx.AsyncClient can only be opened once via `async with`, so tests
    needing several phases (e.g. setup as staff, act as a guest, verify
    as staff again) call this again for each phase rather than re-
    entering another fixture's own instance."""

    def _make() -> AsyncClient:
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    return _make


@pytest.fixture
def create_product_with_stock():
    """A factory for the "active product with one variant" shape several
    checkout/stock tests build on. Takes the already-authenticated (staff)
    AsyncClient to issue the setup requests through, since which one
    depends on the calling test's fixtures. stock=0 (the default) leaves
    the variant genuinely stockless -- no movement at all, same as it
    starts -- rather than rejected by the API's quantity_change != 0
    validation on a POST /stock-movements call that would try to add
    zero."""

    async def _make(ac: AsyncClient, unique: str, stock: int = 0, price: float = 25.0) -> tuple[str, str]:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]
        product_res = await ac.post(
            "/products",
            json={
                "name": f"Item {unique}",
                "slug": f"item-{unique}",
                "category_id": category_id,
                "base_price": price,
                "status": "active",
            },
        )
        product_id = product_res.json()["id"]
        variant_res = await ac.post(
            f"/products/{product_id}/variants", json={"sku": f"SKU-{unique}", "size": "One Size"}
        )
        variant_id = variant_res.json()["id"]
        if stock:
            movement_res = await ac.post(
                "/stock-movements",
                json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": stock},
            )
            assert movement_res.status_code == 201, movement_res.text
        return product_id, variant_id

    return _make


@pytest.fixture
def create_wholesale_customer():
    """A factory for an approved wholesale customer, optionally with a
    credit limit -- the setup several POS-sale credit tests build on.
    Takes the already-authenticated (staff) AsyncClient to issue the
    setup requests through, same convention as create_product_with_stock."""

    async def _make(ac: AsyncClient, unique: str, credit_limit: float = 0) -> str:
        create_res = await ac.post(
            "/customers",
            json={
                "full_name": f"Wholesale Co {unique}",
                "email": f"wholesale-{unique}@example.com",
                "customer_type": "wholesale",
                "credit_limit": credit_limit,
            },
        )
        assert create_res.status_code == 201, create_res.text
        customer_id = create_res.json()["id"]
        approve_res = await ac.post(f"/customers/{customer_id}/status", json={"status": "approved"})
        assert approve_res.status_code == 200, approve_res.text
        return customer_id

    return _make


@pytest.fixture(autouse=True)
def _require_database_url():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; skipping tests that hit the database")
