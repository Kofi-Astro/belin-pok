import uuid

from app.deps import get_current_customer
from app.main import app
from app.models import Customer


async def test_guest_checkout_creates_order_and_decrements_stock(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as ac:
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

    async with fresh_client() as ac:
        variants_res = await ac.get(f"/products/{product_id}/variants")
    variant = next(v for v in variants_res.json() if v["id"] == variant_id)
    assert variant["stock_quantity"] == 1


async def test_repeat_guest_checkout_with_same_email_reuses_existing_guest_customer(
    client, fresh_client, create_product_with_stock
):
    """A second guest checkout with the same email must succeed by reusing
    the customers row created by the first (auth_user_id IS NULL) instead
    of 409ing -- a guest has no password, so "sign in instead" would leave
    them with no way to ever check out again under that email."""
    unique = uuid.uuid4().hex[:8]
    email = f"repeat-guest-{unique}@example.com"
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)

    async with fresh_client() as ac:
        first_res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Repeat Guest",
                "guest_email": email,
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert first_res.status_code == 201, first_res.text
    first_customer_id = first_res.json()["customer_id"]

    async with fresh_client() as ac:
        second_res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Repeat Guest",
                "guest_email": email,
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert second_res.status_code == 201, second_res.text
    assert second_res.json()["customer_id"] == first_customer_id
    assert second_res.json()["id"] != first_res.json()["id"]


async def test_guest_checkout_with_registered_account_email_still_409s(
    client, fresh_client, create_product_with_stock, fake_customer: Customer
):
    """A guest checkout against an email that belongs to a real registered
    account (auth_user_id IS NOT NULL) is a genuine conflict and must keep
    409ing -- that email really does have a password to sign in with."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)

    async with fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Impersonator",
                "guest_email": fake_customer.email,
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert res.status_code == 409
    assert "sign in" in res.json()["detail"].lower()


async def test_checkout_insufficient_stock_returns_409_and_leaves_stock_unchanged(
    client, fresh_client, create_product_with_stock
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, variant_id = await create_product_with_stock(ac, unique, stock=1)

    async with fresh_client() as ac:
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

    async with fresh_client() as ac:
        variants_res = await ac.get(f"/products/{product_id}/variants")
    variant = next(v for v in variants_res.json() if v["id"] == variant_id)
    assert variant["stock_quantity"] == 1


async def test_checkout_merges_duplicate_lines_before_checking_stock(client, fresh_client, create_product_with_stock):
    """Two lines of the same variant (2 + 2) against 3 in stock must 409 --
    checking each line independently against the pre-checkout stock level
    would wrongly let both through."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as ac:
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


async def test_signed_in_checkout_with_saved_address_appears_in_order_history(
    client, customer_client, create_product_with_stock
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)

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


async def test_orders_me_never_returns_another_customers_orders(
    client, fresh_client, create_product_with_stock, fake_customer: Customer
):
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
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=5)

    async with fresh_client() as ac:
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
        async with fresh_client() as ac:
            my_orders_res = await ac.get("/orders/me")
    finally:
        app.dependency_overrides.pop(get_current_customer, None)
    assert my_orders_res.status_code == 200
    assert all(o["id"] != other_order_id for o in my_orders_res.json())


async def test_guest_pickup_checkout_needs_no_address(client, fresh_client, create_product_with_stock):
    """A pickup order has nowhere to ship -- neither address nor
    address_id should be required, unlike delivery."""
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Pickup Guest",
                "guest_email": f"pickup-{unique}@example.com",
                "fulfillment_method": "pickup",
            },
        )
    assert res.status_code == 201, res.text
    assert res.json()["fulfillment_method"] == "pickup"


async def test_delivery_checkout_without_address_returns_400(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "No Address Guest",
                "guest_email": f"noaddr-{unique}@example.com",
                # fulfillment_method omitted -- defaults to 'delivery'.
            },
        )
    assert res.status_code == 400


async def test_checkout_defaults_to_delivery_fulfillment_method(client, fresh_client, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        _product_id, variant_id = await create_product_with_stock(ac, unique, stock=3)

    async with fresh_client() as ac:
        res = await ac.post(
            "/orders/checkout",
            json={
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "guest_full_name": "Default Guest",
                "guest_email": f"default-{unique}@example.com",
                "address": {"line1": "1 Market St", "city": "Accra", "country": "Ghana"},
            },
        )
    assert res.status_code == 201, res.text
    assert res.json()["fulfillment_method"] == "delivery"
