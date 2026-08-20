import uuid


async def _make_category(ac, unique: str) -> str:
    res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _make_variant(ac, unique: str, *, price: float = 20.0, stock: int = 0, category_id: str | None = None):
    if category_id is None:
        category_id = await _make_category(ac, unique)
    product_res = await ac.post(
        "/products",
        json={
            "name": f"Item {unique}",
            "slug": f"item-{unique}",
            "category_id": category_id,
            "base_price": price,
            "status": "active",
        },
    )
    product_id = product_res.json()["id"]
    variant_res = await ac.post(
        f"/products/{product_id}/variants", json={"sku": f"SKU-{unique}", "size": "One Size"}
    )
    variant_id = variant_res.json()["id"]
    if stock:
        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": stock},
        )
        assert movement_res.status_code == 201, movement_res.text
    return product_id, variant_id, category_id


async def test_quick_log_item_requires_variant_or_category(client):
    async with client as ac:
        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"quantity": 1, "unit_price": 20.0}],
                "payments": [{"method": "cash", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 422, sale_res.text


async def test_quick_log_item_requires_unit_price(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _make_category(ac, unique)
        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 422, sale_res.text


async def test_quick_log_pack_tier_rejected_without_variant(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _make_category(ac, unique)
        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "price_tier": "pack", "quantity": 1, "unit_price": 20.0}],
                "payments": [{"method": "cash", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 422, sale_res.text


async def test_quick_logged_sale_records_category_and_no_stock_movement(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id, category_id = await _make_variant(ac, unique, stock=5)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [
                    {"category_id": category_id, "note": "Blue cap, medium", "quantity": 3, "unit_price": 15.0},
                ],
                "payments": [{"method": "cash", "amount": 45.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        sale = sale_res.json()
        item = sale["items"][0]
        assert item["variant_id"] is None
        assert item["category_id"] == category_id
        assert item["note"] == "Blue cap, medium"
        assert item["unit_price"] == 15.0
        assert item["line_total"] == 45.0
        assert sale["total"] == 45.0

        # The known variant's stock is untouched -- nothing was decremented
        # since no specific product was identified.
        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 5


async def test_quick_logged_lines_are_not_merged_even_with_same_category(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _make_category(ac, unique)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [
                    {"category_id": category_id, "quantity": 2, "unit_price": 10.0},
                    {"category_id": category_id, "quantity": 1, "unit_price": 12.0},
                ],
                "payments": [{"method": "cash", "amount": 32.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        assert len(sale_res.json()["items"]) == 2


async def test_identify_attaches_variant_and_decrements_stock(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id, category_id = await _make_variant(ac, unique, price=15.0, stock=10)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 3, "unit_price": 15.0}],
                "payments": [{"method": "cash", "amount": 45.0}],
            },
        )
        sale = sale_res.json()
        item = sale["items"][0]
        assert item["variant_id"] is None

        identify_res = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item['id']}/identify",
            json={"variant_id": variant_id},
        )
        assert identify_res.status_code == 200, identify_res.text
        identified = identify_res.json()["items"][0]
        assert identified["variant_id"] == variant_id
        # Price/quantity charged at sale time are untouched by identifying.
        assert identified["unit_price"] == 15.0
        assert identified["quantity"] == 3

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 7  # 10 - 3, decremented now that it's identified


async def test_identify_rejects_already_identified_item(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=5)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "payments": [{"method": "cash", "amount": 25.0}],
            },
        )
        sale = sale_res.json()
        item = sale["items"][0]
        assert item["variant_id"] == variant_id

        other_variant_id = variant_id  # reuse -- any variant works to prove the 409
        identify_res = await ac.post(
            f"/pos-sales/{sale['id']}/items/{item['id']}/identify",
            json={"variant_id": other_variant_id},
        )
        assert identify_res.status_code == 409, identify_res.text


async def test_identify_insufficient_stock_returns_409_and_leaves_item_unidentified(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id, category_id = await _make_variant(ac, unique, price=15.0, stock=1)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 3, "unit_price": 15.0}],
                "payments": [{"method": "cash", "amount": 45.0}],
            },
        )
        item = sale_res.json()["items"][0]

        identify_res = await ac.post(
            f"/pos-sales/{sale_res.json()['id']}/items/{item['id']}/identify",
            json={"variant_id": variant_id},
        )
        assert identify_res.status_code == 409, identify_res.text
        assert "only has 1 in stock" in identify_res.text

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 1  # untouched


async def test_unidentified_item_count_reflected_on_dashboard(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _make_category(ac, unique)

        before = (await ac.get("/reports/dashboard")).json()["unidentified_item_count"]

        await ac.post(
            "/pos-sales",
            json={
                "items": [{"category_id": category_id, "quantity": 1, "unit_price": 15.0}],
                "payments": [{"method": "cash", "amount": 15.0}],
            },
        )

        after = (await ac.get("/reports/dashboard")).json()["unidentified_item_count"]
        assert after == before + 1
