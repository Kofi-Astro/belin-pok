"""Unsorted sales: a whole basket rung up as one amount when the shop is
packed, then broken down into its real parts later (POST
/pos-sales/{id}/items/{item_id}/break-down)."""

import uuid


async def _make_category(ac, unique: str) -> str:
    res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _make_variant(ac, unique: str, stock: int, category_id: str | None = None) -> tuple[str, str]:
    """An active product with one size in stock; returns (variant_id,
    category_id) and remembers the product so _stock can look it up."""
    category_id = category_id or await _make_category(ac, unique)
    product = await ac.post(
        "/products",
        json={
            "name": f"Item {unique}",
            "slug": f"item-{unique}",
            "category_id": category_id,
            "base_price": 50,
            "status": "active",
        },
    )
    product_id = product.json()["id"]
    variant = await ac.post(f"/products/{product_id}/variants", json={"sku": f"SKU-{unique}", "size": "M"})
    variant_id = variant.json()["id"]
    await ac.post(
        "/stock-movements", json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": stock}
    )
    _products[variant_id] = product_id
    return variant_id, category_id


_products: dict[str, str] = {}


async def _unsorted_sale(ac, amount: float, note: str | None = "2 tees and a cap") -> dict:
    res = await ac.post(
        "/pos-sales",
        json={
            "items": [{"quantity": 1, "unit_price": amount, "note": note}],
            "payments": [{"method": "cash", "amount": amount}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _stock(ac, variant_id: str) -> int:
    variants = (await ac.get(f"/products/{_products[variant_id]}/variants")).json()
    return next(v["stock_quantity"] for v in variants if v["id"] == variant_id)


async def test_unsorted_sale_takes_the_money_and_leaves_stock_alone(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        variant_id, _ = await _make_variant(ac, unique, stock=5)
        sale = await _unsorted_sale(ac, 137.5)
        assert sale["total"] == 137.5
        (line,) = sale["items"]
        assert (line["variant_id"], line["category_id"], line["note"]) == (None, None, "2 tees and a cap")
        assert await _stock(ac, variant_id) == 5

        todo = await ac.get("/pos-sales", params={"needs_details": True, "limit": 500})
        assert sale["id"] in {s["id"] for s in todo.json()}


async def test_break_down_into_products_and_types(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        tee, _ = await _make_variant(ac, unique, stock=5)
        caps = await _make_category(ac, f"caps-{unique}")
        sale = await _unsorted_sale(ac, 137.5)
        item_id = sale["items"][0]["id"]

        # Parts that don't add up to the money taken are refused.
        short = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item_id}/break-down",
            json={"parts": [{"variant_id": tee, "quantity": 2, "unit_price": 50}]},
        )
        assert short.status_code == 409, short.text
        assert "must match" in short.json()["detail"]

        res = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item_id}/break-down",
            json={
                "parts": [
                    {"variant_id": tee, "quantity": 2, "unit_price": 50},
                    {"category_id": caps, "quantity": 1, "unit_price": 37.5, "note": "black snapback"},
                ]
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["total"] == 137.5  # the money doesn't move
        lines = {(i["variant_id"], i["category_id"]): i for i in body["items"]}
        assert set(lines) == {(tee, None), (None, caps)}
        assert lines[(tee, None)]["quantity"] == 2
        assert lines[(None, caps)]["note"] == "black snapback"
        # The named product's stock comes off now; the cap is still a
        # quick-logged line to identify later.
        assert await _stock(ac, tee) == 3

        # Only the original line can be broken down, and only once.
        again = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item_id}/break-down",
            json={"parts": [{"variant_id": tee, "quantity": 1, "unit_price": 137.5}]},
        )
        assert again.status_code == 404

        # Voiding the sale puts the broken-down stock back too.
        voided = await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Test void"})
        assert voided.status_code == 200, voided.text
        assert await _stock(ac, tee) == 5

        log = (await ac.get("/reports/activity", params={"kind": "sale"})).json()
    entry = next(e for e in log if e["reference_id"] == sale["id"] and e["summary"].startswith("Broke down"))
    assert "GH₵137.50" in entry["summary"]
    assert entry["detail"].startswith("Unsorted sale — “2 tees and a cap” → ")
    assert f"Cat caps-{unique} (quick log) ×1 at ₵37.50" in entry["detail"]


async def test_break_down_needs_the_stock_and_a_live_sale(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        variant_id, _ = await _make_variant(ac, unique, stock=1)
        sale = await _unsorted_sale(ac, 60)
        item_id = sale["items"][0]["id"]
        url = f"/pos-sales/{sale['id']}/items/{item_id}/break-down"

        not_enough = await ac.post(url, json={"parts": [{"variant_id": variant_id, "quantity": 2, "unit_price": 30}]})
        assert not_enough.status_code == 409
        assert "only has 1 in stock" in not_enough.json()["detail"]

        nameless = await ac.post(url, json={"parts": [{"quantity": 1, "unit_price": 60}]})
        assert nameless.status_code == 422

        await ac.post(f"/pos-sales/{sale['id']}/void", json={"reason": "Test void"})
        voided = await ac.post(url, json={"parts": [{"variant_id": variant_id, "quantity": 1, "unit_price": 60}]})
        assert voided.status_code == 409


async def test_quick_logged_line_can_be_split_across_products(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        first, category_id = await _make_variant(ac, unique, stock=3)
        second, _ = await _make_variant(ac, f"{unique}b", stock=3, category_id=category_id)
        res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 3, "unit_price": 15}],
                "payments": [{"method": "cash", "amount": 45}],
            },
        )
        sale = res.json()
        item_id = sale["items"][0]["id"]
        split = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item_id}/break-down",
            json={
                "parts": [
                    {"variant_id": first, "quantity": 2, "unit_price": 15},
                    {"variant_id": second, "quantity": 1, "unit_price": 15},
                ]
            },
        )
        assert split.status_code == 200, split.text
        assert (await _stock(ac, first), await _stock(ac, second)) == (1, 2)

        report = (await ac.get("/reports/sales")).json()
    assert not any(p["product_name"] == f"Unidentified Cat {unique} (quick log)" for p in report["by_product"])


async def test_unsorted_sales_show_on_their_own_in_reports(client):
    async with client as ac:
        await _unsorted_sale(ac, 25)
        report = (await ac.get("/reports/sales")).json()
    unsorted = next(p for p in report["by_product"] if p["product_name"] == "Unsorted sales (to break down)")
    assert unsorted["category_name"] == "Unsorted" and unsorted["revenue"] >= 25
    assert any(c["category_name"] == "Unsorted" for c in report["by_category"])
