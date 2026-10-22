import uuid

from sqlalchemy import select

from app.db import async_session_factory
from app.models import AuditLog, Customer, StockMovement, StockNotificationRequest


async def _receive_new(ac, unique: str, **extra) -> dict:
    res = await ac.post(
        "/products/receive",
        json={
            "name": f"Delivery Tee {unique}",
            "image_storage_path": f"products/intake/{unique}.jpg",
            "quantity": 12,
            **extra,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_receive_new_item_with_only_name_photo_quantity_gets_safe_defaults(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        body = await _receive_new(ac, unique)
        categories = (await ac.get("/categories")).json()

    product, variant = body["product"], body["variant"]
    assert body["created_product"] is True
    assert body["created_variant"] is True

    assert product["status"] == "draft"
    assert product["base_price"] == 0
    uncategorized = next(c for c in categories if c["slug"] == "uncategorized")
    assert product["category_id"] == uncategorized["id"]

    assert variant["size"] == "One Size"
    assert variant["color"] is None
    assert variant["sku"] == f"DELIVERY-TEE-{unique}-ONE-SIZE".upper()
    assert variant["stock_quantity"] == 12

    assert len(product["images"]) == 1
    assert product["images"][0]["storage_path"] == f"products/intake/{unique}.jpg"
    assert product["images"][0]["is_primary"] is True


async def test_receive_new_item_writes_initial_movement_and_audit_entry(client, fake_staff):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        body = await _receive_new(ac, unique)

    async with async_session_factory() as session:
        movements = list(
            await session.scalars(
                select(StockMovement).where(StockMovement.variant_id == uuid.UUID(body["variant"]["id"]))
            )
        )
        audit = await session.scalar(
            select(AuditLog).where(AuditLog.record_id == uuid.UUID(body["product"]["id"]))
        )

    assert [(m.movement_type.value, m.quantity_change, m.performed_by) for m in movements] == [
        ("initial", 12, fake_staff.id)
    ]
    assert audit.action == "product.create"
    assert audit.staff_id == fake_staff.id
    assert audit.new_values["status"] == "draft"
    assert audit.new_values["base_price"] == 0


async def test_receive_new_item_honors_optional_details(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        category_id = category_res.json()["id"]
        body = await _receive_new(ac, unique, category_id=category_id, base_price=45.0, size="L", color="Black")

    assert body["product"]["category_id"] == category_id
    assert body["product"]["base_price"] == 45.0
    # Still a draft even when fully priced -- publishing is always a
    # deliberate, separate step.
    assert body["product"]["status"] == "draft"
    assert body["variant"]["size"] == "L"
    assert body["variant"]["color"] == "Black"


async def test_receive_blank_optional_fields_fall_back_to_defaults(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        body = await _receive_new(ac, unique, size="  ", color="")

    assert body["variant"]["size"] == "One Size"
    assert body["variant"]["color"] is None


async def test_receive_new_item_requires_name_photo_and_positive_quantity(client):
    async with client as ac:
        no_photo = await ac.post("/products/receive", json={"name": "Cap", "quantity": 3})
        no_name = await ac.post(
            "/products/receive", json={"image_storage_path": "products/intake/x.jpg", "quantity": 3}
        )
        zero = await ac.post(
            "/products/receive",
            json={"name": "Cap", "image_storage_path": "products/intake/x.jpg", "quantity": 0},
        )
    assert no_photo.status_code == 422
    assert no_name.status_code == 422
    assert zero.status_code == 422


async def test_receive_same_name_twice_creates_two_distinct_products(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        first = await _receive_new(ac, unique)
        second = await _receive_new(ac, unique)

    assert first["product"]["id"] != second["product"]["id"]
    assert first["product"]["slug"] != second["product"]["slug"]
    assert first["variant"]["sku"] != second["variant"]["sku"]


async def test_restock_existing_product_adds_to_matching_variant(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        first = await _receive_new(ac, unique)
        res = await ac.post(
            "/products/receive",
            json={"product_id": first["product"]["id"], "quantity": 5},
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["created_product"] is False
    assert body["created_variant"] is False
    assert body["variant"]["id"] == first["variant"]["id"]
    assert body["variant"]["stock_quantity"] == 17

    async with async_session_factory() as session:
        types = list(
            await session.scalars(
                select(StockMovement.movement_type)
                .where(StockMovement.variant_id == uuid.UUID(first["variant"]["id"]))
                .order_by(StockMovement.created_at)
            )
        )
    assert [t.value for t in types] == ["initial", "restock"]


async def test_restock_existing_product_with_new_size_creates_that_variant(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        first = await _receive_new(ac, unique)
        res = await ac.post(
            "/products/receive",
            json={"product_id": first["product"]["id"], "quantity": 4, "size": "XL"},
        )
        detail = (await ac.get(f"/products/{first['product']['id']}")).json()

    assert res.status_code == 201, res.text
    assert res.json()["created_variant"] is True
    # The placeholder variant's stock is left exactly where it was --
    # nothing is moved between sizes automatically.
    stock = {v["size"]: v["stock_quantity"] for v in detail["variants"]}
    assert stock == {"One Size": 12, "XL": 4}


async def test_restock_rejects_new_item_fields_and_unknown_product(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        first = await _receive_new(ac, unique)
        with_price = await ac.post(
            "/products/receive",
            json={"product_id": first["product"]["id"], "quantity": 1, "base_price": 10},
        )
        unknown = await ac.post("/products/receive", json={"product_id": str(uuid.uuid4()), "quantity": 1})
    assert with_price.status_code == 422
    assert unknown.status_code == 404


async def test_received_draft_cannot_be_sold_at_pos_until_published(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        body = await _receive_new(ac, unique)
        product_id, variant_id = body["product"]["id"], body["variant"]["id"]
        sale = {
            "items": [{"variant_id": variant_id, "quantity": 1}],
            "payments": [{"method": "cash", "amount": 30.0}],
        }

        draft_sale = await ac.post("/pos-sales", json={**sale, "payments": [{"method": "cash", "amount": 0.01}]})
        assert draft_sale.status_code == 409, draft_sale.text
        assert "draft" in draft_sale.json()["detail"]

        category_res = await ac.post("/categories", json={"name": f"Cat {unique}", "slug": f"cat-{unique}"})
        publish = await ac.patch(
            f"/products/{product_id}",
            json={"base_price": 30.0, "category_id": category_res.json()["id"], "status": "active"},
        )
        assert publish.status_code == 200, publish.text

        live_sale = await ac.post("/pos-sales", json=sale)
        assert live_sale.status_code == 201, live_sale.text


async def test_publish_is_blocked_while_price_or_category_is_still_a_placeholder(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        body = await _receive_new(ac, unique)
        product_id = body["product"]["id"]

        unpriced = await ac.patch(f"/products/{product_id}", json={"status": "active"})
        assert unpriced.status_code == 409
        assert "price" in unpriced.json()["detail"]

        uncategorized = await ac.patch(f"/products/{product_id}", json={"base_price": 20.0, "status": "active"})
        assert uncategorized.status_code == 409
        assert "category" in uncategorized.json()["detail"]

        # The rejected publish attempts didn't half-apply the price either.
        detail = (await ac.get(f"/products/{product_id}")).json()
        assert detail["status"] == "draft"
        assert detail["base_price"] == 0


async def test_uncategorized_is_hidden_from_public_categories(client, fresh_client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        await _receive_new(ac, unique)
    async with fresh_client() as ac:
        public = (await ac.get("/public/categories")).json()
    assert all(c["slug"] != "uncategorized" for c in public)


async def test_restock_from_zero_via_receive_notifies_back_in_stock_subscribers(
    client, customer_client, fresh_client, create_product_with_stock, fake_customer: Customer
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique)

    async with customer_client as cc:
        subscribe_res = await cc.post(f"/variants/{variant_id}/notify-when-in-stock")
        assert subscribe_res.status_code == 201, subscribe_res.text

    async with fresh_client() as ac:
        res = await ac.post(
            "/products/receive",
            json={"product_id": product_id, "quantity": 3},
        )
        assert res.status_code == 201, res.text
        assert res.json()["variant"]["id"] == variant_id

    async with async_session_factory() as session:
        request = await session.scalar(
            select(StockNotificationRequest).where(
                StockNotificationRequest.variant_id == uuid.UUID(variant_id),
                StockNotificationRequest.customer_id == fake_customer.id,
            )
        )
    assert request.notified_at is not None
