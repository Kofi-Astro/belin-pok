"""The read-side additions the web storefront and admin rely on: product
lists that carry their variants and a total count, slug lookups, the
all-SKUs inventory table, and orders that describe their own lines,
customer and history."""

import uuid


async def test_public_list_includes_active_variants_and_total_count(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)
        hidden = await ac.post(f"/products/{product_id}/variants", json={"size": "XL", "is_active": False})
        assert hidden.status_code == 201, hidden.text

    async with fresh_client() as anonymous:
        res = await anonymous.get("/public/products", params={"search": f"Item {unique}"})
    assert res.status_code == 200
    assert res.headers["x-total-count"] == "1"
    [product] = res.json()
    # The inactive XL is never shown publicly.
    assert [v["id"] for v in product["variants"]] == [variant_id]
    assert product["variants"][0]["stock_quantity"] == 3


async def test_public_total_count_spans_pages(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        for n in range(3):
            await create_product_with_stock(ac, f"{unique}-{n}")
    async with fresh_client() as anonymous:
        page = await anonymous.get("/public/products", params={"search": unique, "limit": 2})
    assert len(page.json()) == 2
    assert page.headers["x-total-count"] == "3"


async def test_public_product_by_slug_hides_drafts(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, _ = await create_product_with_stock(ac, unique)
    async with fresh_client() as anonymous:
        found = await anonymous.get(f"/public/products/by-slug/item-{unique}")
        assert found.status_code == 200
        assert found.json()["id"] == product_id

    # A fresh client (still signed in as staff via the override): an
    # httpx client can't be reopened once its `async with` has closed it.
    async with fresh_client() as ac:
        await ac.patch(f"/products/{product_id}", json={"status": "draft"})
    async with fresh_client() as anonymous:
        assert (await anonymous.get(f"/public/products/by-slug/item-{unique}")).status_code == 404


async def test_staff_product_list_includes_all_variants_and_count(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, _ = await create_product_with_stock(ac, unique, stock=4)
        await ac.post(f"/products/{product_id}/variants", json={"size": "XL", "is_active": False})
        res = await ac.get("/products", params={"search": f"Item {unique}"})
    assert res.headers["x-total-count"] == "1"
    # Staff see inactive variants too -- they still hold stock to manage.
    assert sorted(v["size"] for v in res.json()[0]["variants"]) == ["One Size", "XL"]


async def test_inventory_table_filters_by_search_and_stock_level(client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, plenty = await create_product_with_stock(ac, f"{unique}-a", stock=50)
        _, low = await create_product_with_stock(ac, f"{unique}-b", stock=2)  # threshold defaults to 5
        _, out = await create_product_with_stock(ac, f"{unique}-c", stock=0)
        archived_id, archived = await create_product_with_stock(ac, f"{unique}-d", stock=9)
        await ac.patch(f"/products/{archived_id}", json={"status": "archived"})

        async def ids(**params):
            res = await ac.get("/variants", params={"search": unique, **params})
            assert res.status_code == 200, res.text
            return res, {row["id"] for row in res.json()}

        everything, all_ids = await ids()
        assert all_ids == {plenty, low, out}  # archived products are left out
        assert everything.headers["x-total-count"] == "3"
        row = next(r for r in everything.json() if r["id"] == low)
        assert row["product_name"] == f"Item {unique}-b"
        assert row["category_name"] == f"Cat {unique}-b"

        assert (await ids(stock="low"))[1] == {low}
        assert (await ids(stock="out"))[1] == {out}
        assert (await ids(stock="in_stock"))[1] == {plenty}

        # SKU search works on its own too (case-insensitive).
        by_sku = await ac.get("/variants", params={"search": f"sku-{unique}-a"})
    assert {r["id"] for r in by_sku.json()} == {plenty}
    assert archived not in all_ids


async def test_orders_describe_their_lines_customer_and_history(
    client, customer_client, fresh_client, create_product_with_stock, fake_customer
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=40.0)

    async with customer_client as cc:
        checkout = await cc.post(
            "/orders/checkout",
            json={"items": [{"variant_id": variant_id, "quantity": 2}], "fulfillment_method": "pickup"},
        )
        assert checkout.status_code == 201, checkout.text
        order = checkout.json()
        mine = (await cc.get("/orders/me")).json()

    [line] = order["items"]
    assert line["product_name"] == f"Item {unique}"
    assert line["product_slug"] == f"item-{unique}"
    assert line["variant_size"] == "One Size"
    assert line["variant_sku"] == f"SKU-{unique}"
    assert order["customer_name"] == fake_customer.full_name
    assert any(o["id"] == order["id"] and o["items"][0]["product_name"] == f"Item {unique}" for o in mine)

    async with fresh_client() as ac:
        updated = await ac.post(f"/orders/{order['id']}/status", json={"status": "packed", "note": "Bagged"})
    assert updated.status_code == 200, updated.text
    assert [(h["status"], h["note"]) for h in updated.json()["status_history"]] == [("packed", "Bagged")]
