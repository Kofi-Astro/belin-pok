"""End-of-day cash-up: the count is checked against what the till
recorded (sales, credit repayments, the float and cash paid out), staff
count blind, and every count is in the owner's activity log."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import async_session_factory
from app.deps import get_current_staff
from app.main import app
from app.models import Staff, StaffRole, User


async def _variant(ac, unique: str, price: float) -> str:
    category = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
    product = await ac.post(
        "/products",
        json={
            "name": f"Item {unique}",
            "slug": f"item-{unique}",
            "category_id": category.json()["id"],
            "base_price": price,
            "status": "active",
        },
    )
    variant = await ac.post(f"/products/{product.json()['id']}/variants", json={"sku": f"SKU-{unique}", "size": "M"})
    variant_id = variant.json()["id"]
    await ac.post(
        "/stock-movements", json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 20}
    )
    return variant_id


async def _sell(ac, variant_id: str, payments: list[dict]) -> dict:
    res = await ac.post(
        "/pos-sales",
        json={"items": [{"variant_id": variant_id, "quantity": 1}], "payments": payments},
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture
async def sales_staff():
    """A real staff member who works the till but isn't an owner."""
    staff_id = uuid.uuid4()
    email = f"till-{staff_id.hex[:8]}@example.com"
    async with async_session_factory() as session:
        session.add(User(id=staff_id, email=email))
        await session.flush()
        staff = Staff(id=staff_id, email=email, full_name="Till Staff", roles=[StaffRole.order_fulfillment.value])
        session.add(staff)
        await session.commit()
    yield staff
    async with async_session_factory() as session:
        await session.execute(text("delete from cash_ups where counted_by = :id"), {"id": staff_id})
        await session.execute(text("delete from users where id = :id"), {"id": staff_id})
        await session.commit()


async def test_count_is_checked_against_the_till(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        before = (await ac.get("/cash-ups/day")).json()["figures"]["money_in"]
        v = await _variant(ac, unique, 100)
        await _sell(ac, v, [{"method": "cash", "amount": 100}])
        await _sell(ac, v, [{"method": "cash", "amount": 40}, {"method": "mobile_money", "amount": 60}])
        after = (await ac.get("/cash-ups/day")).json()["figures"]["money_in"]
        assert round(after["cash"] - before["cash"], 2) == 140
        assert round(after["mobile_money"] - before["mobile_money"], 2) == 60

        # Drawer: ₵50 float + cash in - ₵10 paid out. Counted ₵5 short.
        expected_cash = 50 + after["cash"] - 10
        res = await ac.post(
            "/cash-ups",
            json={
                "opening_float": 50,
                "paid_out": 10,
                "paid_out_note": "Water for the shop",
                "counted_cash": expected_cash - 5,
                "counted_mobile_money": after["mobile_money"],
                "left_in_drawer": 50,
            },
        )
        assert res.status_code == 200, res.text
        saved = res.json()
        assert saved["expected_cash"] == pytest.approx(expected_cash)
        assert saved["cash_difference"] == -5
        assert saved["mobile_money_difference"] == 0
        assert saved["card_difference"] is None
        assert saved["total_difference"] == -5

        # Counting again replaces it; the activity log keeps both.
        redo = await ac.post(
            "/cash-ups",
            json={
                "opening_float": 50,
                "paid_out": 10,
                "paid_out_note": "Water for the shop",
                "counted_cash": expected_cash,
            },
        )
        assert redo.json()["id"] == saved["id"]
        assert redo.json()["cash_difference"] == 0
        activity = (await ac.get("/reports/activity", params={"kind": "cash_up"})).json()
        summaries = [a["summary"] for a in activity]
        assert any("₵5.00 short" in s and s.startswith("Cashed up") for s in summaries)
        assert any(s.startswith("Counted again") and s.endswith("balanced") for s in summaries)

        # A sale voided after the count shows the day has changed since.
        day = (await ac.get("/cash-ups/day")).json()
        assert day["changed_since"] is False
        sale = await _sell(ac, v, [{"method": "cash", "amount": 100}])
        assert (await ac.get("/cash-ups/day")).json()["changed_since"] is True
        await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Test sale"})

        # The owner's history lists it.
        history = (await ac.get("/cash-ups")).json()
        assert saved["id"] in [c["id"] for c in history]


async def test_cash_repayments_are_expected_in_the_drawer(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        customer = (
            await ac.post(
                "/customers",
                json={
                    "full_name": f"Trader {unique}",
                    "customer_type": "wholesale",
                    "phone": "0241234567",
                    "credit_limit": 500,
                },
            )
        ).json()
        await ac.post(
            f"/customers/{customer['id']}/credit-adjustments", json={"amount": 200, "reason": "Opening balance"}
        )
        before = (await ac.get("/cash-ups/day")).json()["figures"]["repayments_by_method"]
        res = await ac.post(
            f"/customers/{customer['id']}/credit-payments", json={"amount": 80, "method": "mobile_money"}
        )
        assert res.status_code == 201, res.text
        assert res.json()["method"] == "mobile_money"
        after = (await ac.get("/cash-ups/day")).json()["figures"]["repayments_by_method"]
        assert round(after["mobile_money"] - before["mobile_money"], 2) == 80


async def test_staff_count_blind_and_cant_see_the_history(sales_staff):
    app.dependency_overrides[get_current_staff] = lambda: sales_staff
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # A past day nobody has counted: no figures until it's counted.
            day = "2020-01-01"
            assert (await ac.get("/cash-ups/day", params={"day": day})).json()["figures"] is None
            res = await ac.post("/cash-ups", json={"business_date": day, "counted_cash": 0})
            assert res.status_code == 200, res.text
            assert (await ac.get("/cash-ups/day", params={"day": day})).json()["figures"] is not None
            assert (await ac.get("/cash-ups")).status_code == 403
            assert (await ac.get("/cash-ups/day", params={"day": "2999-01-01"})).status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_staff, None)


async def test_paid_out_needs_a_note(client):
    async with client as ac:
        res = await ac.post("/cash-ups", json={"business_date": "2020-01-02", "counted_cash": 0, "paid_out": 5})
        assert res.status_code == 422
