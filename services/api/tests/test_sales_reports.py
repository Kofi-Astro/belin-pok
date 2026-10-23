"""The owner's view of the shop: the sales report (tallies by period,
product, staff and category), the sales journal's filters, voids that
record who/when/why, and the activity log.

Other tests write sales into the same database on the same day, so the
report tests measure the *change* their own sales make rather than
absolute totals.
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.db import async_session_factory
from app.shop_time import today


async def _sell(ac, variant_id, quantity, method="cash", price=25.0, customer_id=None):
    body = {
        "items": [{"variant_id": variant_id, "quantity": quantity}],
        "payments": [{"method": method, "amount": price * quantity}],
    }
    if customer_id:
        body["customer_id"] = customer_id
    res = await ac.post("/pos-sales", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _report(ac, **params):
    res = await ac.get("/reports/sales", params=params)
    assert res.status_code == 200, res.text
    return res.json()


def _row(report, *, key, value, field="product_name"):
    return next((r for r in report[key] if r[field] == value), None)


async def test_void_requires_a_reason_and_records_who_and_when(client, create_product_with_stock, fake_staff):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=5)
        sale = await _sell(ac, variant_id, 1)
        assert (await ac.post(f"/pos-sales/{sale['id']}/void")).status_code == 422
        assert (await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "x"})).status_code == 422
        voided = await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Customer changed their mind"})
    assert voided.status_code == 200, voided.text
    body = voided.json()
    assert body["status"] == "voided"
    assert body["void_reason"] == "Customer changed their mind"
    assert body["voided_by"] == str(fake_staff.id)
    assert body["voided_by_name"] == fake_staff.full_name
    assert body["voided_at"] is not None


async def test_sales_journal_filters_by_status_method_staff_and_date(client, create_product_with_stock, fake_staff):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=10)
        cash = await _sell(ac, variant_id, 1, "cash")
        momo = await _sell(ac, variant_id, 2, "mobile_money")
        voided = await _sell(ac, variant_id, 1, "cash")
        await ac.post(f"/pos-sales/{voided['id']}/void", json={"reason": "Wrong item"})

        mine = {"staff_id": str(fake_staff.id), "date_from": today().isoformat(), "date_to": today().isoformat()}
        all_mine = await ac.get("/pos-sales", params=mine)
        momo_only = await ac.get("/pos-sales", params={**mine, "payment_method": "mobile_money"})
        voided_only = await ac.get("/pos-sales", params={**mine, "status": "voided"})
        yesterday = (today() - timedelta(days=1)).isoformat()
        none = await ac.get("/pos-sales", params={**mine, "date_from": yesterday, "date_to": yesterday})

    assert {s["id"] for s in all_mine.json()} >= {cash["id"], momo["id"], voided["id"]}
    assert all_mine.headers["x-total-count"] == str(len(all_mine.json()))
    assert [s["id"] for s in momo_only.json()] == [momo["id"]]
    assert voided["id"] in {s["id"] for s in voided_only.json()}
    assert all(s["status"] == "voided" for s in voided_only.json())
    assert none.json() == []
    # Each receipt says who rang it up and what was in it.
    receipt = next(s for s in all_mine.json() if s["id"] == momo["id"])
    assert receipt["staff_name"] == fake_staff.full_name
    assert receipt["items"][0]["product_name"] == f"Item {unique}" and receipt["items"][0]["quantity"] == 2


async def test_sales_report_tallies_methods_products_staff_and_voids(
    client, fresh_client, create_product_with_stock, create_wholesale_customer, fake_staff
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=20, price=25.0)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=500)
        before = await _report(ac)

        await _sell(ac, variant_id, 2, "cash")  # 50 cash
        await _sell(ac, variant_id, 1, "mobile_money")  # 25 momo
        await _sell(ac, variant_id, 3, "credit", customer_id=customer_id)  # 75 on account
        mistake = await _sell(ac, variant_id, 1, "card")  # 25 card, then voided
        await ac.post(f"/pos-sales/{mistake['id']}/void", json={"reason": "Rang up twice"})
        await ac.post(f"/customers/{customer_id}/credit-payments", json={"amount": 30})

    async with fresh_client() as guest:
        order = await guest.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Online Buyer",
                "fulfillment_method": "pickup",
            },
        )
        assert order.status_code == 201, order.text

    async with fresh_client() as ac:
        after = await _report(ac)

    t0, t1 = before["totals"], after["totals"]
    assert t1["counter_revenue"] - t0["counter_revenue"] == pytest.approx(150)  # the voided 25 isn't revenue
    assert t1["online_revenue"] - t0["online_revenue"] == pytest.approx(25)
    assert t1["receipts"] - t0["receipts"] == 3
    assert t1["online_orders"] - t0["online_orders"] == 1
    assert t1["items_sold"] - t0["items_sold"] == 7  # 2 + 1 + 3 counter, 1 online
    assert t1["by_method"]["cash"] - t0["by_method"]["cash"] == pytest.approx(50)
    assert t1["by_method"]["mobile_money"] - t0["by_method"]["mobile_money"] == pytest.approx(25)
    assert t1["by_method"]["credit"] - t0["by_method"]["credit"] == pytest.approx(75)
    assert t1["by_method"]["card"] - t0["by_method"]["card"] == pytest.approx(0)
    assert t1["voided_count"] - t0["voided_count"] == 1
    assert t1["voided_amount"] - t0["voided_amount"] == pytest.approx(25)
    assert t1["credit_given"] - t0["credit_given"] == pytest.approx(75)
    assert t1["credit_collected"] - t0["credit_collected"] == pytest.approx(30)

    # Today is a single tally row whose figures match the totals.
    [period] = after["periods"]
    assert period["start"] == period["end"] == today().isoformat()
    assert period["revenue"] == pytest.approx(t1["revenue"])

    product = _row(after, key="by_product", value=f"Item {unique}")
    assert (product["quantity"], product["counter_quantity"], product["online_quantity"]) == (7, 6, 1)
    assert product["revenue"] == pytest.approx(175)
    assert product["category_name"] == f"Cat {unique}"
    assert _row(after, key="by_category", value=f"Cat {unique}", field="category_name")["quantity"] == 7

    me0 = _row(before, key="by_staff", value=str(fake_staff.id), field="staff_id") or {
        "receipts": 0,
        "revenue": 0,
        "cash_taken": 0,
        "voided_count": 0,
        "voids_performed": 0,
    }
    me1 = _row(after, key="by_staff", value=str(fake_staff.id), field="staff_id")
    assert me1["staff_name"] == fake_staff.full_name
    assert me1["receipts"] - me0["receipts"] == 3
    assert me1["revenue"] - me0["revenue"] == pytest.approx(150)
    assert me1["cash_taken"] - me0["cash_taken"] == pytest.approx(50)
    assert me1["voided_count"] - me0["voided_count"] == 1
    assert me1["voids_performed"] - me0["voids_performed"] == 1


async def test_report_periods_cover_every_day_week_or_month_in_range(client):
    async with client as ac:
        days = await _report(ac, date_from="2026-03-01", date_to="2026-03-10")
        weeks = await _report(ac, date_from="2026-03-01", date_to="2026-03-31", group_by="week")
        months = await _report(ac, date_from="2026-01-15", date_to="2026-03-10", group_by="month")
        backwards = await ac.get("/reports/sales", params={"date_from": "2026-03-10", "date_to": "2026-03-01"})

    # Every day appears, sales or not.
    assert [p["start"] for p in days["periods"]] == [
        (date(2026, 3, 1) + timedelta(days=i)).isoformat() for i in range(10)
    ]
    # Weeks start on Monday; the first is clipped to the range's start.
    assert weeks["periods"][0]["start"] == "2026-03-01" and weeks["periods"][0]["end"] == "2026-03-01"
    assert weeks["periods"][1]["start"] == "2026-03-02" and weeks["periods"][1]["end"] == "2026-03-08"
    assert weeks["periods"][-1]["end"] == "2026-03-31"
    assert [(p["start"], p["end"]) for p in months["periods"]] == [
        ("2026-01-15", "2026-01-31"),
        ("2026-02-01", "2026-02-28"),
        ("2026-03-01", "2026-03-10"),
    ]
    assert backwards.status_code == 400


async def test_sales_on_another_day_land_in_that_days_row(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=40.0)
        sale = await _sell(ac, variant_id, 1, price=40.0)
    # Backdate it (the API always stamps "now").
    async with async_session_factory() as session:
        await session.execute(
            text("update pos_sales set created_at = '2025-06-03 10:00+00' where id = :id"), {"id": sale["id"]}
        )
        await session.commit()
    async with fresh_client() as ac:
        report = await _report(ac, date_from="2025-06-01", date_to="2025-06-07")
    row = next(p for p in report["periods"] if p["start"] == "2025-06-03")
    assert row["revenue"] >= 40 and row["receipts"] >= 1
    assert _row(report, key="by_product", value=f"Item {unique}")["quantity"] == 1


async def test_activity_log_shows_who_did_what(client, create_product_with_stock, fake_staff):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)
        await ac.patch(f"/products/{product_id}", json={"base_price": 30})
        await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "restock", "quantity_change": 4, "reason": "Delivery"},
        )
        sale = await _sell(ac, variant_id, 2, price=30.0)
        await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Wrong size"})
        invited = await ac.post(
            "/staff/invite", json={"email": f"helper-{unique}@example.com", "full_name": f"Helper {unique}"}
        )
        assert invited.status_code == 201, invited.text

        log = (await ac.get("/reports/activity", params={"staff_id": str(fake_staff.id)})).json()
        voids_only = (await ac.get("/reports/activity", params={"kind": "void", "staff_id": str(fake_staff.id)})).json()

    summaries = [(e["kind"], e["summary"]) for e in log]
    assert ("sale", "Sold 2 items") in summaries
    assert any(k == "void" and "Voided a GH₵60.00 sale" in s for k, s in summaries)
    assert any(k == "stock" and s == f"Restocked Item {unique} (One Size): +4" for k, s in summaries)
    assert any(k == "catalog" and s == f"Changed Item {unique}" for k, s in summaries)
    assert any(k == "staff" and s.startswith(f"Invited Helper {unique}") for k, s in summaries)
    assert all(e["staff_name"] == fake_staff.full_name for e in log)
    sale_entry = next(e for e in log if e["reference_id"] == sale["id"] and e["kind"] == "sale")
    assert f"Item {unique} (One Size) ×2" in sale_entry["detail"]
    price_change = next(e for e in log if e["kind"] == "catalog" and e["summary"] == f"Changed Item {unique}")
    assert "base price: 25.0 → 30.0" in price_change["detail"]
    assert {e["kind"] for e in voids_only} == {"void"}
    assert voids_only[0]["detail"] == "Reason: Wrong size"

    async with async_session_factory() as session:
        await session.execute(text("delete from users where email = :e"), {"e": f"helper-{unique}@example.com"})
        await session.commit()


async def test_report_groups_quick_logged_lines_under_their_category(client, fresh_client):
    """A line rung up by type (no exact product yet) still counts, listed
    as an unidentified item of its category until someone attaches the
    product."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = (
            await ac.post("/categories", json={"name": f"Quick {unique}", "slug": f"quick-{unique}"})
        ).json()["id"]
        sale = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 3, "unit_price": 15}],
                "payments": [{"method": "cash", "amount": 45}],
            },
        )
        assert sale.status_code == 201, sale.text
    async with fresh_client() as ac:
        report = await _report(ac)
    row = _row(report, key="by_product", value=f"Unidentified Quick {unique} (quick log)")
    assert row is not None
    assert (row["quantity"], row["revenue"], row["product_id"]) == (3, 45, None)
    assert _row(report, key="by_category", value=f"Quick {unique}", field="category_name")["revenue"] == 45
