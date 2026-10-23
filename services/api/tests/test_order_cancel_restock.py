"""Cancelling an online order puts its items back on the shelf; reopening
it takes them again (if they're still there)."""

import uuid


async def _stock(ac, product_id: str, variant_id: str) -> int:
    variants = (await ac.get(f"/products/{product_id}/variants")).json()
    return next(v["stock_quantity"] for v in variants if v["id"] == variant_id)


async def _order(fresh_client, variant_id: str, quantity: int) -> dict:
    async with fresh_client() as shopper:
        res = await shopper.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": quantity}],
                "guest_full_name": "Cancel Test",
                "guest_phone": "0200000000",
                "fulfillment_method": "pickup",
            },
        )
    assert res.status_code == 201, res.text
    return res.json()


async def _set_status(ac, order_id: str, new_status: str):
    return await ac.post(f"/orders/{order_id}/status", json={"status": new_status})


async def test_cancelling_returns_stock_and_reopening_takes_it_again(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)
    order = await _order(fresh_client, variant_id, 3)

    async with fresh_client() as ac:
        assert await _stock(ac, product_id, variant_id) == 2
        assert (await _set_status(ac, order["id"], "cancelled")).status_code == 200
        assert await _stock(ac, product_id, variant_id) == 5
        # Cancelling twice doesn't return it twice.
        await _set_status(ac, order["id"], "refunded")
        assert await _stock(ac, product_id, variant_id) == 5

        # Reopened: the stock is taken again.
        assert (await _set_status(ac, order["id"], "pending")).status_code == 200
        assert await _stock(ac, product_id, variant_id) == 2

        # Deleting it afterwards still balances out.
        await _set_status(ac, order["id"], "cancelled")
        await ac.delete(f"/orders/{order['id']}", params={"reason": "Test"})
        assert await _stock(ac, product_id, variant_id) == 5


async def test_reopening_needs_the_stock_to_still_be_there(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=2)
    order = await _order(fresh_client, variant_id, 2)

    async with fresh_client() as ac:
        await _set_status(ac, order["id"], "cancelled")
        # Sold to someone else in the meantime.
        await ac.post(
            "/pos-sales",
            json={"items": [{"variant_id": variant_id, "quantity": 2}], "payments": [{"method": "cash", "amount": 50}]},
        )
        res = await _set_status(ac, order["id"], "paid")
    assert res.status_code == 409
    assert "Can't reopen" in res.json()["detail"]


async def test_a_refund_after_shipping_leaves_stock_alone(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=4)
    order = await _order(fresh_client, variant_id, 1)

    async with fresh_client() as ac:
        await _set_status(ac, order["id"], "shipped")
        await _set_status(ac, order["id"], "refunded")
        # The goods are with the customer; a return is recorded when they come back.
        assert await _stock(ac, product_id, variant_id) == 3


async def test_recording_a_customer_return(client, create_product_with_stock):
    """Regression: "return" is stored by value (the enum member is return_)."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=1)
        res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "return", "quantity_change": 2, "reason": "Brought back"},
        )
        assert res.status_code == 201, res.text
        assert res.json()["movement_type"] == "return"
        assert await _stock(ac, product_id, variant_id) == 3
        listed = (await ac.get("/stock-movements", params={"variant_id": variant_id})).json()
    assert {m["movement_type"] for m in listed} == {"initial", "return"}
