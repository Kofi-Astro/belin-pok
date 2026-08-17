import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import async_session_factory
from app.main import app
from app.models import Customer, StockNotificationRequest


def _fresh_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _setup_product_with_variant(ac, unique: str) -> tuple[str, str]:
    category_res = await ac.post(
        "/categories", json={"name": f"Restock Cat {unique}", "slug": f"restock-cat-{unique}"}
    )
    category_id = category_res.json()["id"]
    product_res = await ac.post(
        "/products",
        json={
            "name": f"Restock Item {unique}",
            "slug": f"restock-item-{unique}",
            "category_id": category_id,
            "base_price": 10,
            "status": "active",
        },
    )
    product_id = product_res.json()["id"]
    variant_res = await ac.post(
        f"/products/{product_id}/variants", json={"sku": f"SKU-RESTOCK-{unique}", "size": "One Size"}
    )
    variant_id = variant_res.json()["id"]
    return product_id, variant_id


async def test_subscribing_to_back_in_stock_is_idempotent_while_pending(client, customer_client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_variant(ac, unique)

    async with customer_client as cc:
        first_res = await cc.post(f"/variants/{variant_id}/notify-when-in-stock")
        assert first_res.status_code == 201, first_res.text

        second_res = await cc.post(f"/variants/{variant_id}/notify-when-in-stock")
        assert second_res.status_code == 201, second_res.text

    assert first_res.json()["id"] == second_res.json()["id"]


async def test_restock_from_zero_marks_pending_subscriptions_notified(
    client, customer_client, fake_customer: Customer
):
    """A variant starts at 0 stock (no initial movement). A subscribed
    customer's request must get notified_at set once a movement brings it
    from 0 to positive -- the zero-crossing check lives in the API layer
    (see stock_movements.py), not the apply_stock_movement DB trigger,
    since the trigger has no way to call out to a push service; this test
    doesn't need real Firebase credentials to verify the DB-side half of
    that (marking notified_at), since push delivery itself is a separate,
    best-effort step that's allowed to silently no-op without them.
    """
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_variant(ac, unique)

    async with customer_client as cc:
        subscribe_res = await cc.post(f"/variants/{variant_id}/notify-when-in-stock")
        assert subscribe_res.status_code == 201, subscribe_res.text

    async with _fresh_client() as ac:
        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "restock", "quantity_change": 5},
        )
        assert movement_res.status_code == 201, movement_res.text

    async with async_session_factory() as session:
        request = await session.scalar(
            select(StockNotificationRequest).where(
                StockNotificationRequest.variant_id == uuid.UUID(variant_id),
                StockNotificationRequest.customer_id == fake_customer.id,
            )
        )
    assert request is not None
    assert request.notified_at is not None


async def test_restock_that_does_not_cross_zero_leaves_subscription_pending(
    client, customer_client, fake_customer: Customer
):
    """Topping up stock that's already positive isn't a "back in stock"
    event -- a pending subscription must stay pending (notified_at still
    null) rather than being consumed by it."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_variant(ac, unique)

        initial_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 3},
        )
        assert initial_res.status_code == 201, initial_res.text

    async with customer_client as cc:
        subscribe_res = await cc.post(f"/variants/{variant_id}/notify-when-in-stock")
        assert subscribe_res.status_code == 201, subscribe_res.text

    async with _fresh_client() as ac:
        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "restock", "quantity_change": 5},
        )
        assert movement_res.status_code == 201, movement_res.text

    async with async_session_factory() as session:
        request = await session.scalar(
            select(StockNotificationRequest).where(
                StockNotificationRequest.variant_id == uuid.UUID(variant_id),
                StockNotificationRequest.customer_id == fake_customer.id,
            )
        )
    assert request is not None
    assert request.notified_at is None
