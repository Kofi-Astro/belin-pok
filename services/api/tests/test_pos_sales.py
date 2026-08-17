import uuid


async def _make_variant(
    ac,
    unique: str,
    *,
    price: float = 20.0,
    wholesale_price: float | None = None,
    pack_price: float | None = None,
    pack_size: int | None = None,
    stock: int = 0,
) -> tuple[str, str]:
    category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
    category_id = category_res.json()["id"]
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
        f"/products/{product_id}/variants",
        json={
            "sku": f"SKU-{unique}",
            "size": "One Size",
            "wholesale_price": wholesale_price,
            "pack_price": pack_price,
            "pack_size": pack_size,
        },
    )
    assert variant_res.status_code == 201, variant_res.text
    variant_id = variant_res.json()["id"]
    if stock:
        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": stock},
        )
        assert movement_res.status_code == 201, movement_res.text
    return product_id, variant_id


async def test_retail_pos_sale_decrements_stock_and_records_item(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _make_variant(ac, unique, price=20.0, stock=5)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "cash", "amount": 40.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        sale = sale_res.json()
        assert sale["total"] == 40.0
        assert sale["items"][0]["price_tier"] == "retail"
        assert sale["items"][0]["quantity"] == 2

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 3


async def test_wholesale_tier_uses_wholesale_price_and_falls_back_when_unset(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, priced_variant = await _make_variant(ac, f"{unique}-a", price=20.0, wholesale_price=15.0, stock=10)
        _, unpriced_variant = await _make_variant(ac, f"{unique}-b", price=30.0, stock=10)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [
                    {"variant_id": priced_variant, "price_tier": "wholesale", "quantity": 4},
                    {"variant_id": unpriced_variant, "price_tier": "wholesale", "quantity": 1},
                ],
                "payments": [{"method": "cash", "amount": 4 * 15.0 + 30.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        items = {item["variant_id"]: item for item in sale_res.json()["items"]}
        assert items[priced_variant]["unit_price"] == 15.0
        assert items[unpriced_variant]["unit_price"] == 30.0


async def test_pack_tier_requires_pack_pricing_configured(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await _make_variant(ac, unique, price=20.0, stock=10)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": variant_id, "price_tier": "pack", "quantity": 1}],
                "payments": [{"method": "cash", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 409, sale_res.text
        assert "pack pricing" in sale_res.text


async def test_pack_tier_prices_by_pack_and_decrements_full_pack_size(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _make_variant(
            ac, unique, price=20.0, pack_price=60.0, pack_size=6, stock=18
        )

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": variant_id, "price_tier": "pack", "quantity": 2}],
                "payments": [{"method": "cash", "amount": 120.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        item = sale_res.json()["items"][0]
        assert item["quantity"] == 12  # 2 packs x pack_size 6
        assert item["line_total"] == 120.0

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 6  # 18 - 12


async def test_credit_payment_requires_a_customer(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await _make_variant(ac, unique, price=20.0, stock=5)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "payments": [{"method": "credit", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 400, sale_res.text


async def test_credit_payment_rejected_for_non_wholesale_customer(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await _make_variant(ac, unique, price=20.0, stock=5)
        customer_res = await ac.post(
            "/customers",
            json={"full_name": "Retail Person", "email": f"retail-{unique}@example.com"},
        )
        customer_id = customer_res.json()["id"]

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "payments": [{"method": "credit", "amount": 20.0}],
            },
        )
        assert sale_res.status_code == 409, sale_res.text
        assert "not an approved wholesale account" in sale_res.text


async def test_credit_payment_within_limit_charges_customer_balance(client, create_wholesale_customer):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await _make_variant(ac, unique, price=20.0, stock=5)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "credit", "amount": 40.0}],
            },
        )
        assert sale_res.status_code == 201, sale_res.text
        assert sale_res.json()["credit_amount"] == 40.0

        customer_res = await ac.get(f"/customers/{customer_id}")
        assert customer_res.json()["outstanding_balance"] == 40.0


async def test_credit_payment_over_limit_is_rejected_and_nothing_is_charged(client, create_wholesale_customer):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _make_variant(ac, unique, price=20.0, stock=10)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=30.0)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "credit", "amount": 40.0}],
            },
        )
        assert sale_res.status_code == 409, sale_res.text
        assert "credit limit" in sale_res.text

        customer_res = await ac.get(f"/customers/{customer_id}")
        assert customer_res.json()["outstanding_balance"] == 0.0

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 10  # untouched -- the whole sale rolled back


async def test_voiding_a_credit_sale_reverses_the_customer_balance(client, create_wholesale_customer):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await _make_variant(ac, unique, price=20.0, stock=5)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)

        sale_res = await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "credit", "amount": 40.0}],
            },
        )
        sale_id = sale_res.json()["id"]

        void_res = await ac.post(f"/pos-sales/{sale_id}/void")
        assert void_res.status_code == 200, void_res.text

        customer_res = await ac.get(f"/customers/{customer_id}")
        assert customer_res.json()["outstanding_balance"] == 0.0
