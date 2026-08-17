import uuid

from app.models import Customer


async def test_staff_updates_order_status_and_push_is_best_effort(
    client, customer_client, fresh_client, create_product_with_stock, fake_customer: Customer
):
    """The status update itself must succeed regardless of push delivery --
    no FIREBASE_SERVICE_ACCOUNT_JSON is configured in tests, so this also
    exercises app.push.send_push's no-Firebase-configured path (logs and
    returns rather than raising) without needing real credentials. See
    app/push.py for why a delivery failure can never affect this response.
    """
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)

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

    async with fresh_client() as ac:
        status_res = await ac.post(f"/orders/{order_id}/status", json={"status": "shipped"})
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["status"] == "shipped"
