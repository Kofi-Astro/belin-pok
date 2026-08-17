import uuid

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models import Customer


def _fresh_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_staff_updates_order_status_and_push_is_best_effort(
    client, customer_client, fake_customer: Customer
):
    """The status update itself must succeed regardless of push delivery --
    no FIREBASE_SERVICE_ACCOUNT_JSON is configured in tests, so this also
    exercises app.push.send_push's no-Firebase-configured path (logs and
    returns rather than raising) without needing real credentials. See
    app/push.py for why a delivery failure can never affect this response.
    """
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post(
            "/categories", json={"name": f"Status Cat {unique}", "slug": f"status-cat-{unique}"}
        )
        category_id = category_res.json()["id"]
        product_res = await ac.post(
            "/products",
            json={
                "name": f"Status Item {unique}",
                "slug": f"status-item-{unique}",
                "category_id": category_id,
                "base_price": 15,
                "status": "active",
            },
        )
        product_id = product_res.json()["id"]
        variant_res = await ac.post(
            f"/products/{product_id}/variants", json={"sku": f"SKU-STATUS-{unique}", "size": "One Size"}
        )
        variant_id = variant_res.json()["id"]
        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 5},
        )
        assert movement_res.status_code == 201, movement_res.text

    async with customer_client as ac:
        address_res = await ac.post(
            "/customers/me/addresses", json={"line1": "1 Market St", "city": "Accra", "country": "Ghana"}
        )
        address_id = address_res.json()["id"]
        checkout_res = await ac.post(
            "/orders/checkout",
            json={"items": [{"variant_id": variant_id, "quantity": 1}], "address_id": address_id},
        )
        assert checkout_res.status_code == 201, checkout_res.text
        order_id = checkout_res.json()["id"]

        # A device token for this customer so the push path actually sends
        # (and still no-ops cleanly without Firebase configured), not just
        # skips early on an empty token list.
        token_res = await ac.post(
            "/customers/me/device-tokens", json={"platform": "ios", "token": f"tok-{unique}"}
        )
        assert token_res.status_code == 204, token_res.text

    async with _fresh_client() as ac:
        status_res = await ac.post(f"/orders/{order_id}/status", json={"status": "shipped"})
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["status"] == "shipped"
