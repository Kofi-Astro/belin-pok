"""Owners deleting test or junk records outright (app/erase.py): the record
goes, what it did is undone (stock, credit), and the activity log keeps a
note of who deleted what and why."""

import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text

from app.db import async_session_factory


async def _stock(ac, product_id: str, variant_id: str) -> int:
    variants = (await ac.get(f"/products/{product_id}/variants")).json()
    return next(v["stock_quantity"] for v in variants if v["id"] == variant_id)


async def _deleted_entries(ac) -> list[dict]:
    return (await ac.get("/reports/activity", params={"kind": "deleted"})).json()


@pytest.fixture
async def staff_emails():
    """Removes the non-owner accounts a test invites."""
    created: list[str] = []
    yield created
    async with async_session_factory() as session:
        for email in created:
            await session.execute(text("delete from users where email = :e"), {"e": email})
        await session.commit()


async def test_deleting_a_till_sale_puts_stock_and_credit_back(
    client, create_product_with_stock, create_wholesale_customer
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=5, price=25)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=500)
        before = (await ac.get("/reports/sales")).json()["totals"]["revenue"]
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "customer_id": customer_id,
                    "items": [{"variant_id": variant_id, "quantity": 2}],
                    "payments": [{"method": "credit", "amount": 50}],
                },
            )
        ).json()
        assert await _stock(ac, product_id, variant_id) == 3
        assert (await ac.get(f"/customers/{customer_id}")).json()["outstanding_balance"] == 50

        # A reason is required.
        assert (await ac.delete(f"/pos-sales/{sale['id']}")).status_code == 422
        res = await ac.delete(f"/pos-sales/{sale['id']}", params={"reason": "Trying out the till"})
        assert res.status_code == 204, res.text

        assert await _stock(ac, product_id, variant_id) == 5
        assert (await ac.get(f"/customers/{customer_id}")).json()["outstanding_balance"] == 0
        journal = (await ac.get("/pos-sales", params={"customer_id": customer_id})).json()
        assert journal == []
        assert (await ac.get("/reports/sales")).json()["totals"]["revenue"] == pytest.approx(before)
        log = await _deleted_entries(ac)

    entry = next(e for e in log if f"Item {unique} (One Size) ×2" in (e["detail"] or ""))
    assert entry["summary"] == "Deleted a ₵50.00 sale rung up by Test Owner"
    assert "Reason: Trying out the till" in entry["detail"]


async def test_a_voided_sale_can_be_deleted_too(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=4)
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "items": [{"variant_id": variant_id, "quantity": 1}],
                    "payments": [{"method": "cash", "amount": 25}],
                },
            )
        ).json()
        await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Wrong size"})
        res = await ac.delete(f"/pos-sales/{sale['id']}", params={"reason": "Test data"})
        assert res.status_code == 204, res.text
        # The sale and its reversal cancel out: stock is where it started.
        assert await _stock(ac, product_id, variant_id) == 4


async def test_a_credit_sale_already_paid_for_is_refused(client, create_product_with_stock, create_wholesale_customer):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=25)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=500)
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "customer_id": customer_id,
                    "items": [{"variant_id": variant_id, "quantity": 2}],
                    "payments": [{"method": "credit", "amount": 50}],
                },
            )
        ).json()
        await ac.post(f"/customers/{customer_id}/credit-payments", json={"amount": 50})
        res = await ac.delete(f"/pos-sales/{sale['id']}", params={"reason": "Test"})
    assert res.status_code == 409
    assert "already paid" in res.json()["detail"]


async def test_only_owners_can_delete(client, fresh_client, staff_emails, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    email = f"staff-{unique}@example.com"
    staff_emails.append(email)
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=2)
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "items": [{"variant_id": variant_id, "quantity": 1}],
                    "payments": [{"method": "cash", "amount": 25}],
                },
            )
        ).json()
        invite = await ac.post(
            "/staff/invite", json={"email": email, "full_name": "Sales Staff", "roles": ["order_fulfillment"]}
        )
        token = parse_qs(urlparse(invite.json()["invite_link"]).query)["token"][0]
        tokens = (await ac.post("/auth/set-password", json={"token": token, "new_password": "staff-password"})).json()

    # Their request carries only their own token: drop the fixture's owner
    # override so require_role sees *them*.
    from app.deps import get_current_staff
    from app.main import app

    app.dependency_overrides.pop(get_current_staff, None)
    async with fresh_client() as staff:
        staff.headers["Authorization"] = f"Bearer {tokens['access_token']}"
        res = await staff.delete(f"/pos-sales/{sale['id']}", params={"reason": "Not mine to delete"})
    assert res.status_code == 403


async def test_deleting_an_online_order_and_then_its_test_customer(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as shopper:
        order = (
            await shopper.post(
                "/orders/checkout",
                json={
                    "items": [{"variant_id": variant_id, "quantity": 2}],
                    "guest_full_name": f"Test Shopper {unique}",
                    "guest_phone": "0200000000",
                    "fulfillment_method": "pickup",
                },
            )
        ).json()

    async with fresh_client() as ac:
        assert await _stock(ac, product_id, variant_id) == 1
        customer_id = order["customer_id"]
        # The customer can't go while their order is still there.
        held = await ac.delete(f"/customers/{customer_id}", params={"reason": "Test shopper"})
        assert held.status_code == 409
        assert "1 online order" in held.json()["detail"]

        res = await ac.delete(f"/orders/{order['id']}", params={"reason": "Test order"})
        assert res.status_code == 204, res.text
        assert (await ac.get(f"/orders/{order['id']}")).status_code == 404
        assert await _stock(ac, product_id, variant_id) == 3

        res = await ac.delete(f"/customers/{customer_id}", params={"reason": "Test shopper"})
        assert res.status_code == 204, res.text
        assert (await ac.get(f"/customers/{customer_id}")).status_code == 404
        log = await _deleted_entries(ac)

    summaries = [e["summary"] for e in log]
    assert (
        f"Deleted online order {order['order_number']} (₵{order['total']:.2f}) from Test Shopper {unique}" in summaries
    )
    assert f"Deleted customer Test Shopper {unique}" in summaries


async def test_deleting_a_stock_entry(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=2)
        received = (
            await ac.post(
                "/stock-movements",
                json={"variant_id": variant_id, "movement_type": "restock", "quantity_change": 10, "reason": "Test"},
            )
        ).json()
        assert await _stock(ac, product_id, variant_id) == 12

        res = await ac.delete(f"/stock-movements/{received['id']}", params={"reason": "Entered by mistake"})
        assert res.status_code == 204, res.text
        assert await _stock(ac, product_id, variant_id) == 2

        # A sale's own stock entry belongs to the sale.
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "items": [{"variant_id": variant_id, "quantity": 1}],
                    "payments": [{"method": "cash", "amount": 25}],
                },
            )
        ).json()
        movements = (await ac.get("/stock-movements", params={"variant_id": variant_id})).json()
        sale_movement = next(m for m in movements if m["reference_id"] == sale["id"])
        res = await ac.delete(f"/stock-movements/{sale_movement['id']}", params={"reason": "Test"})
        assert res.status_code == 409
        assert "till sale" in res.json()["detail"]

        # Units received and since sold can't be taken back out.
        opening = next(m for m in movements if m["movement_type"] == "initial")
        res = await ac.delete(f"/stock-movements/{opening['id']}", params={"reason": "Test"})
        assert res.status_code == 409


async def test_owner_deletes_a_test_product_with_stock_history_but_not_a_sold_one(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, _ = await create_product_with_stock(ac, unique, stock=6)
        res = await ac.delete(f"/products/{product_id}", params={"reason": "Test item"})
        assert res.status_code == 204, res.text
        assert (await ac.get(f"/products/{product_id}")).status_code == 404

        sold_id, variant_id = await create_product_with_stock(ac, f"{unique}b", stock=6)
        await ac.post(
            "/pos-sales",
            json={"items": [{"variant_id": variant_id, "quantity": 1}], "payments": [{"method": "cash", "amount": 25}]},
        )
        res = await ac.delete(f"/products/{sold_id}")
        assert res.status_code == 409
        assert "1 till sale line" in res.json()["detail"]
        log = await _deleted_entries(ac)

    entry = next(e for e in log if e["summary"] == f"Deleted product Item {unique}")
    assert entry["detail"] == "Reason: Test item"
