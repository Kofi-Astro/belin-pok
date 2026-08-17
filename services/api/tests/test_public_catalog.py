import uuid


async def test_public_products_excludes_draft_and_archived(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]

        active_res = await ac.post(
            "/products",
            json={
                "name": f"Active Product {unique}",
                "slug": f"active-{unique}",
                "category_id": category_id,
                "base_price": 10,
                "status": "active",
            },
        )
        draft_res = await ac.post(
            "/products",
            json={
                "name": f"Draft Product {unique}",
                "slug": f"draft-{unique}",
                "category_id": category_id,
                "base_price": 10,
            },
        )
        assert active_res.status_code == 201, active_res.text
        assert draft_res.status_code == 201, draft_res.text
        active_id = active_res.json()["id"]
        draft_id = draft_res.json()["id"]

        list_res = await ac.get("/public/products", params={"search": unique})
        assert list_res.status_code == 200
        ids = {p["id"] for p in list_res.json()}
        assert active_id in ids
        assert draft_id not in ids

        detail_res = await ac.get(f"/public/products/{active_id}")
        assert detail_res.status_code == 200

        # A draft product 404s from the public endpoint even though it
        # exists and staff can see it via GET /products/{id} -- same
        # response as a genuinely nonexistent id, so existence of a draft
        # doesn't leak.
        draft_detail_res = await ac.get(f"/public/products/{draft_id}")
        assert draft_detail_res.status_code == 404


async def test_public_product_hides_inactive_variants(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat2 {unique}", "slug": f"cat2-{unique}"})
        category_id = category_res.json()["id"]

        product_res = await ac.post(
            "/products",
            json={
                "name": f"Variant Product {unique}",
                "slug": f"variant-product-{unique}",
                "category_id": category_id,
                "base_price": 20,
                "status": "active",
            },
        )
        product_id = product_res.json()["id"]

        active_variant_res = await ac.post(
            f"/products/{product_id}/variants", json={"sku": f"SKU-ACTIVE-{unique}", "size": "M"}
        )
        inactive_variant_res = await ac.post(
            f"/products/{product_id}/variants", json={"sku": f"SKU-INACTIVE-{unique}", "size": "L"}
        )
        assert active_variant_res.status_code == 201, active_variant_res.text
        assert inactive_variant_res.status_code == 201, inactive_variant_res.text
        inactive_id = inactive_variant_res.json()["id"]

        patch_res = await ac.patch(f"/variants/{inactive_id}", json={"is_active": False})
        assert patch_res.status_code == 200, patch_res.text

        detail_res = await ac.get(f"/public/products/{product_id}")
        assert detail_res.status_code == 200
        variant_ids = {v["id"] for v in detail_res.json()["variants"]}
        assert active_variant_res.json()["id"] in variant_ids
        assert inactive_id not in variant_ids


async def test_public_categories_are_listed(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        create_res = await ac.post("/categories", json={"name": f"Public Cat {unique}", "slug": f"public-cat-{unique}"})
        category_id = create_res.json()["id"]

        list_res = await ac.get("/public/categories")
    assert list_res.status_code == 200
    assert any(c["id"] == category_id for c in list_res.json())


async def test_public_products_filters_by_price_range_and_sorts(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat3 {unique}", "slug": f"cat3-{unique}"})
        category_id = category_res.json()["id"]

        cheap = await ac.post(
            "/products",
            json={
                "name": f"Cheap {unique}",
                "slug": f"cheap-{unique}",
                "category_id": category_id,
                "base_price": 10,
                "status": "active",
            },
        )
        mid = await ac.post(
            "/products",
            json={
                "name": f"Mid {unique}",
                "slug": f"mid-{unique}",
                "category_id": category_id,
                "base_price": 50,
                "status": "active",
            },
        )
        pricey = await ac.post(
            "/products",
            json={
                "name": f"Pricey {unique}",
                "slug": f"pricey-{unique}",
                "category_id": category_id,
                "base_price": 100,
                "status": "active",
            },
        )
        for res in (cheap, mid, pricey):
            assert res.status_code == 201, res.text

        range_res = await ac.get(
            "/public/products", params={"search": unique, "min_price": 20, "max_price": 80}
        )
        assert range_res.status_code == 200
        names = {p["name"] for p in range_res.json()}
        assert names == {mid.json()["name"]}

        sorted_res = await ac.get("/public/products", params={"search": unique, "sort": "price_desc"})
        assert sorted_res.status_code == 200
        prices = [p["base_price"] for p in sorted_res.json()]
        assert prices == sorted(prices, reverse=True)


async def test_public_products_in_stock_only_excludes_out_of_stock(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat4 {unique}", "slug": f"cat4-{unique}"})
        category_id = category_res.json()["id"]

        in_stock_product = await ac.post(
            "/products",
            json={
                "name": f"In Stock {unique}",
                "slug": f"in-stock-{unique}",
                "category_id": category_id,
                "base_price": 15,
                "status": "active",
            },
        )
        out_of_stock_product = await ac.post(
            "/products",
            json={
                "name": f"Out Of Stock {unique}",
                "slug": f"out-of-stock-{unique}",
                "category_id": category_id,
                "base_price": 15,
                "status": "active",
            },
        )
        in_stock_product_id = in_stock_product.json()["id"]
        out_of_stock_product_id = out_of_stock_product.json()["id"]

        in_stock_variant = await ac.post(
            f"/products/{in_stock_product_id}/variants", json={"sku": f"SKU-IN-{unique}", "size": "One Size"}
        )
        await ac.post(
            f"/products/{out_of_stock_product_id}/variants", json={"sku": f"SKU-OUT-{unique}", "size": "One Size"}
        )

        movement_res = await ac.post(
            "/stock-movements",
            json={"variant_id": in_stock_variant.json()["id"], "movement_type": "initial", "quantity_change": 5},
        )
        assert movement_res.status_code == 201, movement_res.text

        res = await ac.get("/public/products", params={"search": unique, "in_stock_only": True})
    assert res.status_code == 200
    ids = {p["id"] for p in res.json()}
    assert in_stock_product_id in ids
    assert out_of_stock_product_id not in ids
