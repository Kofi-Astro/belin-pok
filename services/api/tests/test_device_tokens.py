import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import async_session_factory
from app.deps import get_current_customer
from app.main import app
from app.models import Customer, CustomerDeviceToken


def _fresh_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_register_device_token_requires_signed_in_customer():
    async with _fresh_client() as ac:
        res = await ac.post("/customers/me/device-tokens", json={"platform": "ios", "token": "tok-anonymous"})
    assert res.status_code == 401


async def test_register_and_unregister_device_token(customer_client):
    token = f"tok-{uuid.uuid4().hex}"
    async with customer_client as ac:
        register_res = await ac.post("/customers/me/device-tokens", json={"platform": "android", "token": token})
        assert register_res.status_code == 204, register_res.text

        # Re-registering the same token (e.g. the app re-launching) upserts
        # rather than conflicting -- a device token is unique per device,
        # not per registration attempt.
        register_again_res = await ac.post(
            "/customers/me/device-tokens", json={"platform": "android", "token": token}
        )
        assert register_again_res.status_code == 204, register_again_res.text

        unregister_res = await ac.delete(f"/customers/me/device-tokens/{token}")
        assert unregister_res.status_code == 204, unregister_res.text


async def test_unregister_is_scoped_to_the_calling_customer(customer_client, fake_customer: Customer):
    """One customer can't unregister a token registered by someone else,
    even if they know its value -- the DELETE is scoped by customer_id, so
    it's a silent no-op (still 204) rather than able to affect another
    customer's row. Deliberately doesn't reuse the customer_client fixture
    for the "other customer" half (same reasoning as
    test_orders_me_never_returns_another_customers_orders in
    test_checkout.py): its override is global on `app`, not scoped to a
    request's actual headers, so it has to be swapped out manually rather
    than layered under a second fixture.
    """
    token = f"tok-{uuid.uuid4().hex}"
    async with customer_client as ac:
        register_res = await ac.post("/customers/me/device-tokens", json={"platform": "ios", "token": token})
        assert register_res.status_code == 204, register_res.text

    other_customer = Customer(id=uuid.uuid4(), full_name="Someone Else", email=f"other-{uuid.uuid4().hex}@example.com")
    app.dependency_overrides[get_current_customer] = lambda: other_customer
    try:
        async with _fresh_client() as ac:
            res = await ac.delete(f"/customers/me/device-tokens/{token}")
    finally:
        app.dependency_overrides.pop(get_current_customer, None)
    assert res.status_code == 204  # silent no-op, not an error that would leak whether the token exists

    async with async_session_factory() as session:
        still_there = await session.scalar(select(CustomerDeviceToken).where(CustomerDeviceToken.token == token))
    assert still_there is not None
