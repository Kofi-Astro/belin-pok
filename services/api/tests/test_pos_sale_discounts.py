"""Discounts at the till: an amount off the whole sale, with a reason,
shared out across the lines so every report shows the money really
taken."""

import uuid


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
        "/stock-movements", json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 10}
    )
    return variant_id


async def test_discount_is_shared_across_lines_and_payments_cover_the_rest(client):
    a, b = uuid.uuid4().hex[:8], uuid.uuid4().hex[:8]
    async with client as ac:
        joggers, cap = await _variant(ac, a, 150), await _variant(ac, b, 50)
        res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": joggers, "quantity": 1}, {"variant_id": cap, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 180}],
                "discount": 20,
                "discount_reason": "Regular customer",
            },
        )
        assert res.status_code == 201, res.text
        sale = res.json()
        assert (sale["subtotal"], sale["discount_total"], sale["total"]) == (200, 20, 180)
        assert sale["discount_reason"] == "Regular customer"
        # ₵20 split 3:1, like the prices.
        shares = sorted((i["unit_price"], i["discount"], i["line_total"]) for i in sale["items"])
        assert shares == [(50, 5, 45), (150, 15, 135)]

        # The journal can show just the discounted sales.
        discounted = (await ac.get("/pos-sales", params={"discounted": True})).json()
        assert sale["id"] in [s["id"] for s in discounted]

        # Reports count what was really taken, and the discount itself.
        report = (await ac.get("/reports/sales")).json()
        assert report["totals"]["discounts_given"] >= 20
        assert report["totals"]["discounted_receipts"] >= 1


async def test_odd_pesewas_still_add_up(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        a = await _variant(ac, unique, 10)
        b = await _variant(ac, unique + "b", 10)
        c = await _variant(ac, unique + "c", 10)
        res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": v, "quantity": 1} for v in (a, b, c)],
                "payments": [{"method": "cash", "amount": 29}],
                "discount": 1,
                "discount_reason": "Rounding down",
            },
        )
        assert res.status_code == 201, res.text
        assert round(sum(i["discount"] for i in res.json()["items"]), 2) == 1
        assert res.json()["total"] == 29


async def test_a_discount_needs_a_reason_and_cant_exceed_the_sale(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        v = await _variant(ac, unique, 100)
        no_reason = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": v, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 90}],
                "discount": 10,
            },
        )
        assert no_reason.status_code == 422
        too_much = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": v, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 1}],
                "discount": 150,
                "discount_reason": "Too generous",
            },
        )
        assert too_much.status_code == 409
        # Paying the full price when a discount was given doesn't balance.
        wrong_total = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": v, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 100}],
                "discount": 10,
                "discount_reason": "Haggled",
            },
        )
        assert wrong_total.status_code == 409


async def test_breaking_down_a_discounted_one_amount_line_uses_what_was_charged(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        v = await _variant(ac, unique, 45)
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "items": [{"quantity": 1, "unit_price": 100}],
                    "payments": [{"method": "cash", "amount": 90}],
                    "discount": 10,
                    "discount_reason": "Bulk buy",
                },
            )
        ).json()
        item = sale["items"][0]
        res = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item['id']}/break-down",
            json={"parts": [{"variant_id": v, "quantity": 2, "unit_price": 45}]},
        )
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 90
