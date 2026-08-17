import uuid


async def test_dashboard_reports_revenue_by_tier_top_variants_and_aged_debtors(
    client, create_wholesale_customer, create_product_with_stock
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, retail_variant = await create_product_with_stock(ac, f"{unique}-r", stock=5, price=20.0)
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)
        product_res = await ac.post(
            "/categories", json={"name": f"Cat {unique}-w", "slug": f"cat-{unique}-w"}
        )
        category_id = product_res.json()["id"]
        wholesale_product_res = await ac.post(
            "/products",
            json={
                "name": f"Item {unique}-w",
                "slug": f"item-{unique}-w",
                "category_id": category_id,
                "base_price": 30.0,
                "status": "active",
            },
        )
        wholesale_product_id = wholesale_product_res.json()["id"]
        wholesale_variant_res = await ac.post(
            f"/products/{wholesale_product_id}/variants",
            json={"sku": f"SKU-{unique}-w", "size": "One Size", "wholesale_price": 22.0},
        )
        wholesale_variant = wholesale_variant_res.json()["id"]
        await ac.post(
            "/stock-movements",
            json={"variant_id": wholesale_variant, "movement_type": "initial", "quantity_change": 10},
        )

        await ac.post(
            "/pos-sales",
            json={
                "items": [{"variant_id": retail_variant, "quantity": 2}],
                "payments": [{"method": "cash", "amount": 40.0}],
            },
        )
        await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": wholesale_variant, "price_tier": "wholesale", "quantity": 3}],
                "payments": [{"method": "credit", "amount": 66.0}],
            },
        )

        dashboard_res = await ac.get("/reports/dashboard")
        assert dashboard_res.status_code == 200, dashboard_res.text
        data = dashboard_res.json()

        assert data["gross_revenue"] >= 106.0
        assert data["items_sold"] >= 5
        tiers = {t["price_tier"]: t for t in data["revenue_by_tier"]}
        assert tiers["retail"]["revenue"] >= 40.0
        assert tiers["wholesale"]["revenue"] >= 66.0

        top_skus = {v["variant_id"] for v in data["top_variants"]}
        assert retail_variant in top_skus
        assert wholesale_variant in top_skus

        debtor = next(d for d in data["aged_debtors"] if d["customer_id"] == customer_id)
        assert debtor["outstanding_balance"] == 66.0
        assert debtor["days_outstanding"] == 0
        assert data["total_outstanding_credit"] >= 66.0
