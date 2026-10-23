"""Staff holding more than one role: what they can do is the union of
their roles. Signed in for real (invite link -> set password -> token),
so require_role is exercised exactly as in production."""

import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text

from app.db import async_session_factory


@pytest.fixture
async def emails():
    """Collects invited staff emails and removes those accounts afterwards."""
    created: list[str] = []
    yield created
    async with async_session_factory() as session:
        for email in created:
            await session.execute(text("delete from users where email = :e"), {"e": email})
        await session.commit()


async def _invite_and_sign_in(ac, emails, **body) -> tuple[dict, dict]:
    """Invites a staff member (as the fixture owner), accepts the invite,
    and returns (staff record, bearer headers for them)."""
    email = f"staff-{uuid.uuid4().hex[:8]}@example.com"
    emails.append(email)
    res = await ac.post("/staff/invite", json={"email": email, "full_name": "Combo Staff", **body})
    assert res.status_code == 201, res.text
    token = parse_qs(urlparse(res.json()["invite_link"]).query)["token"][0]
    tokens = (await ac.post("/auth/set-password", json={"token": token, "new_password": "staff-password"})).json()
    return res.json(), {"Authorization": f"Bearer {tokens['access_token']}"}


async def _an_order(ac, create_product_with_stock) -> str:
    unique = uuid.uuid4().hex[:8]
    _, variant_id = await create_product_with_stock(ac, unique, stock=3)
    checkout = await ac.post(
        "/orders/checkout",
        json={
            "items": [{"variant_id": variant_id, "quantity": 1}],
            "guest_full_name": "Guest",
            "fulfillment_method": "pickup",
        },
    )
    return checkout.json()["id"]


async def test_inventory_manager_who_also_does_sales_can_do_both(
    client, fresh_client, emails, create_product_with_stock
):
    async with client as ac:
        staff, me = await _invite_and_sign_in(ac, emails, roles=["inventory_manager", "order_fulfillment"])
        order_id = await _an_order(ac, create_product_with_stock)
        categories = (await ac.get("/categories")).json()

    assert staff["roles"] == ["inventory_manager", "order_fulfillment"]
    assert staff["role"] == "inventory_manager"  # most senior, for display

    # The staff member's own requests carry only their token: drop the
    # fixture's owner override so require_role sees *them*.
    from app.deps import get_current_staff
    from app.main import app

    app.dependency_overrides.pop(get_current_staff, None)
    async with fresh_client() as ac:
        unique = uuid.uuid4().hex[:8]
        product = await ac.post(
            "/products",
            headers=me,
            json={
                "name": f"Combo {unique}",
                "slug": f"combo-{unique}",
                "category_id": categories[0]["id"],
                "base_price": 10,
            },
        )
        order = await ac.post(f"/orders/{order_id}/status", headers=me, json={"status": "packed"})
        staff_list = await ac.get("/staff", headers=me)
    assert product.status_code == 201, product.text  # inventory side
    assert order.status_code == 200, order.text  # sales side
    assert staff_list.status_code == 403  # still not an owner


async def test_a_single_role_still_only_does_its_own_job(client, fresh_client, emails, create_product_with_stock):
    async with client as ac:
        _, me = await _invite_and_sign_in(ac, emails, roles=["inventory_manager"])
        order_id = await _an_order(ac, create_product_with_stock)

    from app.deps import get_current_staff
    from app.main import app

    app.dependency_overrides.pop(get_current_staff, None)
    async with fresh_client() as ac:
        order = await ac.post(f"/orders/{order_id}/status", headers=me, json={"status": "packed"})
    assert order.status_code == 403


async def test_role_combinations_are_validated_and_editable(client, emails, fake_staff):
    async with client as ac:
        for bad in (["owner", "inventory_manager"], ["viewer", "order_fulfillment"], []):
            res = await ac.post(
                "/staff/invite", json={"email": f"x-{uuid.uuid4().hex[:6]}@example.com", "full_name": "X", "roles": bad}
            )
            assert res.status_code == 422, (bad, res.text)

        # The older single-role form still works.
        legacy, _ = await _invite_and_sign_in(ac, emails, role="order_fulfillment")
        assert legacy["roles"] == ["order_fulfillment"]

        updated = await ac.patch(f"/staff/{legacy['id']}", json={"roles": ["order_fulfillment", "inventory_manager"]})
        assert updated.status_code == 200, updated.text
        assert sorted(updated.json()["roles"]) == ["inventory_manager", "order_fulfillment"]

        # An owner can't lock themselves out.
        self_demote = await ac.patch(f"/staff/{fake_staff.id}", json={"roles": ["viewer"]})
        self_off = await ac.patch(f"/staff/{fake_staff.id}", json={"is_active": False})
        rename = await ac.patch(f"/staff/{fake_staff.id}", json={"full_name": "Test Owner"})
    assert self_demote.status_code == self_off.status_code == 400
    assert rename.status_code == 200
