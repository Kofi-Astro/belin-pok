"""In-store vs online prices (app/pricing.py): staff enter in-store
prices, which the till charges; the website and phone app see -- and
checkout charges -- the in-store price plus the shop's online markup,
unless a variant has its own fixed online price."""

import uuid

import pytest
from sqlalchemy import text

from app.db import async_session_factory


@pytest.fixture
async def markup():
    """Sets the shop's online pricing for one test, then puts it back to
    "no markup" -- it's a single shop-wide row other tests price through."""

    async def _set(percent: float, rounding: float = 0) -> None:
        async with async_session_factory() as session:
            await session.execute(
                text("update shop_settings set online_markup_percent = :p, online_price_rounding = :r"),
                {"p": percent, "r": rounding},
            )
            await session.commit()

    yield _set
    await _set(0, 0)


async def _priced_product(ac, create_product_with_stock, unique, base=85.0):
    product_id, variant_id = await create_product_with_stock(ac, unique, stock=10, price=base)
    # A second size with its own in-store price, and a third with a fixed
    # online price.
    pricier = (await ac.post(f"/products/{product_id}/variants", json={"size": "XL", "price_override": 90})).json()
    fixed = (
        await ac.post(
            f"/products/{product_id}/variants",
            json={"size": "XXL", "online_price": 120, "wholesale_price": 60, "pack_price": 300, "pack_size": 6},
        )
    ).json()
    for v in (pricier, fixed):
        await ac.post(
            "/stock-movements", json={"variant_id": v["id"], "movement_type": "initial", "quantity_change": 5}
        )
    return product_id, variant_id, pricier["id"], fixed["id"]


async def test_shoppers_see_online_prices_and_nothing_else(client, fresh_client, create_product_with_stock, markup):
    await markup(10, 1)  # +10%, rounded up to the next cedi
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, one_size, xl, xxl = await _priced_product(ac, create_product_with_stock, unique)
        staff_view = (await ac.get(f"/products/{product_id}")).json()

    async with fresh_client() as shopper:
        public = (await shopper.get(f"/public/products/by-slug/item-{unique}")).json()
        listed = (await shopper.get("/public/products", params={"search": f"Item {unique}"})).json()[0]

    # 85 * 1.10 = 93.50 -> rounded up to 94.
    assert public["base_price"] == 94
    variants = {v["id"]: v for v in public["variants"]}
    assert variants[one_size]["price_override"] is None  # same as the product's online base
    assert variants[xl]["price_override"] == 99  # 90 * 1.10 = 99.00
    assert variants[xxl]["price_override"] == 120  # its own fixed online price
    # In-store, wholesale and pack prices never reach the public.
    for v in public["variants"]:
        assert v["wholesale_price"] is None and v["pack_price"] is None and v["pack_size"] is None
        assert v["online_price"] is None
    assert listed["base_price"] == 94

    # Staff still see -- and edit -- the in-store prices.
    assert staff_view["base_price"] == 85
    staff_xxl = next(v for v in staff_view["variants"] if v["id"] == xxl)
    assert (staff_xxl["wholesale_price"], staff_xxl["online_price"]) == (60, 120)


async def test_online_orders_pay_online_prices_and_the_till_pays_in_store(
    client, fresh_client, create_product_with_stock, markup
):
    await markup(10, 1)
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, one_size, xl, _ = await _priced_product(ac, create_product_with_stock, unique)
        before = (await ac.get("/reports/sales")).json()["totals"]
        counter = await ac.post(
            "/pos-sales",
            json={"items": [{"variant_id": one_size, "quantity": 1}], "payments": [{"method": "cash", "amount": 85}]},
        )
        assert counter.status_code == 201, counter.text  # in-store price at the till

    async with fresh_client() as shopper:
        order = await shopper.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": one_size, "quantity": 2}, {"variant_id": xl, "quantity": 1}],
                "guest_full_name": "Online Shopper",
                "fulfillment_method": "pickup",
            },
        )
    assert order.status_code == 201, order.text
    lines = {i["variant_id"]: i for i in order.json()["items"]}
    assert (lines[one_size]["unit_price"], lines[one_size]["in_store_unit_price"]) == (94, 85)
    assert (lines[xl]["unit_price"], lines[xl]["in_store_unit_price"]) == (99, 90)
    assert order.json()["total"] == 94 * 2 + 99

    async with fresh_client() as ac:
        after = (await ac.get("/reports/sales")).json()["totals"]
    # (94-85)*2 + (99-90)*1 = 27 earned by the online markup.
    assert after["online_markup_earned"] - before["online_markup_earned"] == pytest.approx(27)


async def test_settings_are_validated_and_changes_show_in_the_activity_log(client, markup):
    async with client as ac:
        assert (await ac.get("/settings")).json()["online_markup_percent"] == 0
        assert (await ac.patch("/settings", json={"online_markup_percent": 500})).status_code == 422
        changed = await ac.patch("/settings", json={"online_markup_percent": 12.5, "online_price_rounding": 0.5})
        assert changed.status_code == 200, changed.text
        assert (changed.json()["online_markup_percent"], changed.json()["online_price_rounding"]) == (12.5, 0.5)
        log = (await ac.get("/reports/activity", params={"kind": "catalog"})).json()
    entry = next(e for e in log if e["summary"] == "Changed online pricing")
    assert "online markup percent: 0.0 → 12.5" in entry["detail"]
