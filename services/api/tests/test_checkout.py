import uuid

from httpx import ASGITransport, AsyncClient

from app.deps import get_current_customer
from app.main import app
from app.models import Customer


def _fresh_client() -> AsyncClient:
    # A plain client with no dependency overrides of its own. Which
    # identity (if any) a request through it resolves to depends entirely
    # on what's registered in app.dependency_overrides at call time (set
    # by whichever of the client/customer_client fixtures the test is
    # using) -- not on anything about this particular AsyncClient
    # instance. httpx.AsyncClient can only be opened once via `async
    # with`, so tests that need several phases build a fresh one per
    # phase rather than re-entering the client/customer_client fixture's
    # own instance.
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _setup_product_with_stock(ac, unique: str, stock: int, price: float = 25.0) -> tuple[str, str]:
    category_res = await ac.post(
        "/categories", json={"name": f"Checkout Cat {unique}", "slug": f"checkout-cat-{unique}"}
    )
    category_id = category_res.json()["id"]
    product_res = await ac.post(
        "/products",
        json={
            "name": f"Checkout Item {unique}",
            "slug": f"checkout-item-{unique}",
            "category_id": category_id,
            "base_price": price,
            "status": "active",
        },
    )
    product_id = product_res.json()["id"]
    variant_res = await ac.post(
        f"/products/{product_id}/variants", json={"sku": f"SKU-CHECKOUT-{unique}", "size": "One Size"}
    )
    variant_id = variant_res.json()["id"]
    movement_res = await ac.post(
        "/stock-movements",
        json={"variant_id": variant_id, "movement_type": "initial", "quantity_change": stock},
    )
    assert movement_res.status_code == 201, movement_res.text
    return product_id, variant_id


async def test_guest_checkout_creates_order_and_decrements_stock(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _setup_product_with_stock(ac, unique, stock=3)

    async with _fresh_client() as ac:
        checkout_res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "guest_full_name": "Guest Shopper",
                "guest_email": f"guest-{unique}@example.com",
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert checkout_res.status_code == 201, checkout_res.text
    order = checkout_res.json()
    assert order["status"] == "pending"
    assert order["order_type"] == "retail"
    assert len(order["items"]) == 1
    assert order["items"][0]["quantity"] == 2
    assert order["total"] == 50.0

    async with _fresh_client() as ac:
        variants_res = await ac.get(f"/products/{product_id}/variants")
    variant = next(v for v in variants_res.json() if v["id"] == variant_id)
    assert variant["stock_quantity"] == 1


async def test_checkout_insufficient_stock_returns_409_and_leaves_stock_unchanged(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await _setup_product_with_stock(ac, unique, stock=1)

    async with _fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 5}],
                "guest_full_name": "Greedy Guest",
                "guest_email": f"greedy-{unique}@example.com",
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert res.status_code == 409

    async with _fresh_client() as ac:
        variants_res = await ac.get(f"/products/{product_id}/variants")
    variant = next(v for v in variants_res.json() if v["id"] == variant_id)
    assert variant["stock_quantity"] == 1


async def test_checkout_merges_duplicate_lines_before_checking_stock(client):
    """Two lines of the same variant (2 + 2) against 3 in stock must 409 --
    checking each line independently against the pre-checkout stock level
    would wrongly let both through."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_stock(ac, unique, stock=3)

    async with _fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [
                    {"variant_id": variant_id, "quantity": 2},
                    {"variant_id": variant_id, "quantity": 2},
                ],
                "guest_full_name": "Duplicate Line Guest",
                "guest_email": f"dupe-{unique}@example.com",
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert res.status_code == 409


async def test_signed_in_checkout_with_saved_address_appears_in_order_history(client, customer_client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_stock(ac, unique, stock=5)

    async with customer_client as ac:
        address_res = await ac.post(
            "/customers/me/addresses", json={"line1": "10 High St", "city": "Kumasi", "country": "Ghana"}
        )
        assert address_res.status_code == 201, address_res.text
        address_id = address_res.json()["id"]

        checkout_res = await ac.post(
            "/orders/checkout",
            json={"items": [{"variant_id": variant_id, "quantity": 1}], "address_id": address_id},
        )
        assert checkout_res.status_code == 201, checkout_res.text
        order_id = checkout_res.json()["id"]

        my_orders_res = await ac.get("/orders/me")
    assert my_orders_res.status_code == 200
    assert any(o["id"] == order_id for o in my_orders_res.json())


async def test_orders_me_never_returns_another_customers_orders(client, fake_customer: Customer):
    """Deliberately doesn't use the customer_client fixture for the whole
    test: its get_optional_customer override would stay active for the
    "someone else" guest checkout below too (overrides are global on
    `app`, not scoped to a request's actual headers), silently attaching
    that order to fake_customer instead of creating an unrelated guest --
    which would make this test pass without checking anything. The
    get_current_customer override is applied manually, only around the
    final call, once the other guest's order already exists without it.
    """
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await _setup_product_with_stock(ac, unique, stock=5)

    async with _fresh_client() as ac:
        other_res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Someone Else",
                "guest_email": f"someone-{unique}@example.com",
                "address": {"line1": "2 Side St", "city": "Tema", "country": "Ghana"},
            },
        )
    assert other_res.status_code == 201, other_res.text
    other_order_id = other_res.json()["id"]

    app.dependency_overrides[get_current_customer] = lambda: fake_customer
    try:
        async with _fresh_client() as ac:
            my_orders_res = await ac.get("/orders/me")
    finally:
        app.dependency_overrides.pop(get_current_customer, None)
    assert my_orders_res.status_code == 200
    assert all(o["id"] != other_order_id for o in my_orders_res.json())
