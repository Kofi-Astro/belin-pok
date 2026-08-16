import uuid


async def test_add_and_list_product_images(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]

        product_res = await ac.post(
            "/products",
            json={
                "name": f"Product {unique}",
                "slug": f"product-{unique}",
                "category_id": category_id,
                "base_price": 9.99,
            },
        )
        assert product_res.status_code == 201, product_res.text
        product = product_res.json()
        assert product["images"] == []
        product_id = product["id"]

        img1 = await ac.post(
            f"/products/{product_id}/images",
            json={"storage_path": f"products/{product_id}/one.jpg", "is_primary": True},
        )
        assert img1.status_code == 201, img1.text
        assert img1.json()["is_primary"] is True

        img2 = await ac.post(
            f"/products/{product_id}/images",
            json={"storage_path": f"products/{product_id}/two.jpg", "is_primary": True},
        )
        assert img2.status_code == 201, img2.text

        list_res = await ac.get(f"/products/{product_id}/images")
        assert list_res.status_code == 200
        images = list_res.json()
        assert len(images) == 2
        # Setting img2 as primary should have unset img1's primary flag.
        primaries = [i for i in images if i["is_primary"]]
        assert len(primaries) == 1
        assert primaries[0]["id"] == img2.json()["id"]

        get_res = await ac.get(f"/products/{product_id}")
        assert len(get_res.json()["images"]) == 2

        delete_res = await ac.delete(f"/images/{img1.json()['id']}")
        assert delete_res.status_code == 204

        list_res_2 = await ac.get(f"/products/{product_id}/images")
        assert len(list_res_2.json()) == 1
