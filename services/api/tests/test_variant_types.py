"""Types / qualities within one broad product: "Joggers" sold as Standard
(130), Premium (150) and Branded (180), each with its own sizes, stock and
price; and items named after their category."""

import uuid


async def _category(ac, unique: str) -> str:
    res = await ac.post("/categories", json={"name": f"Joggers {unique}", "slug": f"joggers-{unique}"})
    return res.json()["id"]


async def test_one_product_many_types_each_priced(client, fresh_client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _category(ac, unique)
        product = (
            await ac.post(
                "/products",
                json={
                    "name": "Joggers",
                    "slug": "joggers",
                    "category_id": category_id,
                    "base_price": 130,
                    "status": "active",
                },
            )
        ).json()
        made = {}
        for style, price in (("Standard", None), ("Premium", 150), ("Branded", 180)):
            res = await ac.post(
                f"/products/{product['id']}/variants",
                json={"size": "M", "style": f" {style} ", "price_override": price},
            )
            assert res.status_code == 201, res.text
            made[style] = res.json()
        # The same size can't exist twice within one type...
        dup = await ac.post(f"/products/{product['id']}/variants", json={"size": "M", "style": "Premium"})
        assert dup.status_code == 409
        # ...and a blank type means "no type".
        plain = (await ac.post(f"/products/{product['id']}/variants", json={"size": "M", "style": "  "})).json()
        assert plain["style"] is None

        assert made["Premium"]["style"] == "Premium"  # trimmed
        assert "-PREMIUM-M" in made["Premium"]["sku"]
        for style in made:
            await ac.post(
                "/stock-movements",
                json={"variant_id": made[style]["id"], "movement_type": "initial", "quantity_change": 5},
            )
        sale = await ac.post(
            "/pos-sales",
            json={
                "items": [
                    {"variant_id": made["Standard"]["id"], "quantity": 1},
                    {"variant_id": made["Branded"]["id"], "quantity": 1},
                ],
                "payments": [{"method": "cash", "amount": 310}],
            },
        )
        assert sale.status_code == 201, sale.text
        lines = {i["variant_style"]: i["unit_price"] for i in sale.json()["items"]}
        assert lines == {"Standard": 130, "Branded": 180}

    async with fresh_client() as shopper:
        public = (await shopper.get(f"/public/products/{product['id']}")).json()
    assert sorted(v["style"] or "" for v in public["variants"]) == ["", "Branded", "Premium", "Standard"]


async def test_receiving_by_type_and_naming_after_the_category(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_id = await _category(ac, unique)
        photo = (
            await ac.post("/uploads/product-photo", files={"file": ("p.png", b"\x89PNG\r\n\x1a\n", "image/png")})
        ).json()
        first = await ac.post(
            "/products/receive",
            json={
                "category_id": category_id,
                "image_storage_path": photo["storage_path"],
                "quantity": 4,
                "style": "Unbranded",
                "size": "L",
            },
        )
        assert first.status_code == 201, first.text
        body = first.json()
        assert body["product"]["name"] == f"Joggers {unique}"  # named after the category
        assert (body["variant"]["style"], body["variant"]["stock_quantity"]) == ("Unbranded", 4)

        # More of a different type of the same product: a new variant.
        more = await ac.post(
            "/products/receive",
            json={"product_id": body["product"]["id"], "quantity": 2, "style": "Nike", "size": "L"},
        )
        assert more.json()["created_variant"] is True
        # The same type again: a restock of that variant.
        again = await ac.post(
            "/products/receive",
            json={"product_id": body["product"]["id"], "quantity": 1, "style": "Unbranded", "size": "L"},
        )
        assert again.json()["created_variant"] is False
        assert again.json()["variant"]["stock_quantity"] == 5

        # A second product with the same broad name is fine.
        twin = await ac.post(
            "/products/receive",
            json={"category_id": category_id, "image_storage_path": photo["storage_path"], "quantity": 1},
        )
        assert twin.status_code == 201
        assert twin.json()["product"]["slug"] != body["product"]["slug"]

        # No name and no category: refused.
        neither = await ac.post("/products/receive", json={"image_storage_path": photo["storage_path"], "quantity": 1})
        assert neither.status_code == 422
