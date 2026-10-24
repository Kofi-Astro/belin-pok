"""Returns against a till sale: stock back (unless damaged), a refund by
any method -- or none, for an exchange -- and the refund counted out of
the drawer at cash-up."""

import uuid


async def _variant(ac, unique: str, price: float) -> tuple[str, str]:
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
    product_id = product.json()["id"]
    variant = await ac.post(f"/products/{product_id}/variants", json={"sku": f"SKU-{unique}", "size": "M"})
    variant_id = variant.json()["id"]
    await ac.post(
        "/stock-movements", json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 10}
    )
    return product_id, variant_id


async def _stock(ac, product_id: str, variant_id: str) -> int:
    variants = (await ac.get(f"/products/{product_id}/variants")).json()
    return next(v["stock_quantity"] for v in variants if v["id"] == variant_id)


async def test_return_puts_stock_back_and_refund_comes_off_the_drawer(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _variant(ac, unique, 100)
        sale = (
            await ac.post(
                "/pos-sales",
                json={
                    "items": [{"variant_id": variant_id, "quantity": 2}],
                    "payments": [{"method": "cash", "amount": 180}],
                    "discount": 20,
                    "discount_reason": "Two for 180",
                },
            )
        ).json()
        assert await _stock(ac, product_id, variant_id) == 8
        before = (await ac.get("/cash-ups/day")).json()["figures"]["refunds_by_method"]["cash"]
        item = sale["items"][0]

        # One back: it sold for ₵90 after the discount, so ₵100 is too much.
        too_much = await ac.post(
            f"/pos-sales/{sale['id']}/returns",
            json={
                "items": [{"sale_item_id": item["id"], "quantity": 1}],
                "refund_amount": 100,
                "refund_method": "cash",
                "reason": "Too small",
            },
        )
        assert too_much.status_code == 409
        res = await ac.post(
            f"/pos-sales/{sale['id']}/returns",
            json={
                "items": [{"sale_item_id": item["id"], "quantity": 1}],
                "refund_amount": 90,
                "refund_method": "cash",
                "reason": "Too small",
            },
        )
        assert res.status_code == 201, res.text
        assert res.json()["items"][0]["returned_quantity"] == 1
        assert res.json()["refunded_total"] == 90
        assert await _stock(ac, product_id, variant_id) == 9
        after = (await ac.get("/cash-ups/day")).json()["figures"]["refunds_by_method"]["cash"]
        assert round(after - before, 2) == 90

        # The second, damaged: an exchange-style return with no refund and
        # nothing back on the shelf.
        res = await ac.post(
            f"/pos-sales/{sale['id']}/returns",
            json={
                "items": [{"sale_item_id": item["id"], "quantity": 1}],
                "reason": "Torn seam",
                "back_to_stock": False,
            },
        )
        assert res.status_code == 201, res.text
        assert await _stock(ac, product_id, variant_id) == 9

        # Nothing left to return, and a sale with returns can't be voided.
        more = await ac.post(
            f"/pos-sales/{sale['id']}/returns",
            json={"items": [{"sale_item_id": item["id"], "quantity": 1}], "reason": "Again"},
        )
        assert more.status_code == 409
        assert (await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Mistake"})).status_code == 409

        report = (await ac.get("/reports/sales")).json()["totals"]
        assert report["refunds_given"] >= 90 and report["returns_count"] >= 2

        # Deleting the (test) sale undoes the sale and its returns.
        res = await ac.delete(f"/pos-sales/{sale['id']}", params={"reason": "Test sale"})
        assert res.status_code == 204, res.text
        assert await _stock(ac, product_id, variant_id) == 10


async def test_unsorted_lines_must_be_sorted_out_before_a_return(client):
    async with client as ac:
        sale = (
            await ac.post(
                "/pos-sales",
                json={"items": [{"quantity": 1, "unit_price": 50}], "payments": [{"method": "cash", "amount": 50}]},
            )
        ).json()
        res = await ac.post(
            f"/pos-sales/{sale['id']}/returns",
            json={"items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}], "reason": "Changed mind"},
        )
        assert res.status_code == 409
