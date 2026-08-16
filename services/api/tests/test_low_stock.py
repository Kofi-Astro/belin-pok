import uuid


async def test_low_stock_includes_product_name_and_image(client, fake_staff):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]

        product_res = await ac.post(
            "/products",
            json={
                "name": f"Low Stock Item {unique}",
                "slug": f"low-stock-{unique}",
                "category_id": category_id,
                "base_price": 5,
            },
        )
        product_id = product_res.json()["id"]

        image_res = await ac.post(
            f"/products/{product_id}/images",
            json={"storage_path": f"products/{product_id}/cover.jpg", "is_primary": True},
        )
        assert image_res.status_code == 201, image_res.text

        variant_res = await ac.post(
            f"/products/{product_id}/variants",
            json={"sku": f"SKU-{unique}", "size": "M", "low_stock_threshold": 10},
        )
        assert variant_res.status_code == 201, variant_res.text
        variant_id = variant_res.json()["id"]

        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 3},
        )
        assert movement_res.status_code == 201, movement_res.text

        low_stock_res = await ac.get("/variants/low-stock")
        assert low_stock_res.status_code == 200
        entries = [e for e in low_stock_res.json() if e["id"] == variant_id]
        assert len(entries) == 1
        entry = entries[0]
        assert entry["product_name"] == f"Low Stock Item {unique}"
        assert entry["image_storage_path"] == f"products/{product_id}/cover.jpg"
        assert entry["stock_quantity"] == 3
