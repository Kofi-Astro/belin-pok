import uuid


async def test_create_and_list_products(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post(
            "/categories",
            json={"name": f"Test Caps {unique}", "slug": f"test-caps-{unique}"},
        )
        assert category_res.status_code == 201, category_res.text
        category_id = category_res.json()["id"]

        product_res = await ac.post(
            "/products",
            json={
                "name": f"Test Snapback {unique}",
                "slug": f"test-snapback-{unique}",
                "category_id": category_id,
                "base_price": 19.99,
            },
        )
        assert product_res.status_code == 201, product_res.text
        product = product_res.json()
        assert product["name"] == f"Test Snapback {unique}"
        assert product["status"] == "draft"

        list_res = await ac.get("/products", params={"search": f"Snapback {unique}"})
        assert list_res.status_code == 200
        assert any(p["id"] == product["id"] for p in list_res.json())


async def test_create_product_unknown_category_returns_error(client):
    async with client as ac:
        response = await ac.post(
            "/products",
            json={
                "name": "Orphan Product",
                "slug": "orphan-product",
                "category_id": "00000000-0000-0000-0000-000000000000",
                "base_price": 9.99,
            },
        )
    assert response.status_code in (400, 409, 422)
