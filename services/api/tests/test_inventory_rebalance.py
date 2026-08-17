import uuid


async def test_rebalance_requires_pack_size_configured(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=12)

        res = await ac.post(
            "/inventory/rebalance",
            json={"lines": [{"variant_id": variant_id, "pack_count": 2}]},
        )
        assert res.status_code == 409, res.text
        assert "pack_size" in res.text


async def test_rebalance_records_audit_entry_without_changing_stock_quantity(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]
        product_res = await ac.post(
            "/products",
            json={"name": f"Item {unique}", "slug": f"item-{unique}", "category_id": category_id, "base_price": 20},
        )
        product_id = product_res.json()["id"]
        variant_res = await ac.post(
            f"/products/{product_id}/variants",
            json={"sku": f"SKU-{unique}", "size": "One Size", "pack_price": 60, "pack_size": 6},
        )
        variant_id = variant_res.json()["id"]
        await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 18},
        )

        res = await ac.post(
            "/inventory/rebalance",
            json={"lines": [{"variant_id": variant_id, "pack_count": 3}], "note": "Shelf restock"},
        )
        assert res.status_code == 200, res.text
        line = res.json()["lines"][0]
        assert line["units_packed"] == 18
        assert line["stock_quantity"] == 18  # unchanged -- rebalancing doesn't move stock, just organizes it

        variants_res = await ac.get(f"/products/{product_id}/variants")
        variant = next(v for v in variants_res.json() if v["id"] == variant_id)
        assert variant["stock_quantity"] == 18

        audit_res = await ac.get("/audit-log", params={"table_name": "product_variants", "record_id": variant_id})
        assert audit_res.status_code == 200, audit_res.text
        entries = [e for e in audit_res.json() if e["action"] == "inventory.rebalance"]
        assert len(entries) == 1
        assert entries[0]["new_values"]["pack_count"] == 3


async def test_rebalance_rejects_more_packs_than_stock_on_hand(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]
        product_res = await ac.post(
            "/products",
            json={"name": f"Item {unique}", "slug": f"item-{unique}", "category_id": category_id, "base_price": 20},
        )
        product_id = product_res.json()["id"]
        variant_res = await ac.post(
            f"/products/{product_id}/variants",
            json={"sku": f"SKU-{unique}", "size": "One Size", "pack_price": 60, "pack_size": 6},
        )
        variant_id = variant_res.json()["id"]
        await ac.post(
            "/stock-movements",
            json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": 6},
        )

        res = await ac.post(
            "/inventory/rebalance",
            json={"lines": [{"variant_id": variant_id, "pack_count": 5}]},
        )
        assert res.status_code == 409, res.text
        assert "only has 6 units" in res.text
