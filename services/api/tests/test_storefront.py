"""The website's editable content (app/routers/storefront.py): defaults,
editing, featured products and validation."""

import uuid

import pytest
from sqlalchemy import text

from app.db import async_session_factory


@pytest.fixture
async def reset_content():
    """The content is a single shared row: put it back to defaults after."""
    yield
    async with async_session_factory() as session:
        await session.execute(text("update storefront_content set content = '{}'::jsonb"))
        await session.commit()


async def test_defaults_are_the_original_wording(client, fresh_client, reset_content):
    async with fresh_client() as shopper:
        res = await shopper.get("/public/storefront")
    assert res.status_code == 200
    body = res.json()
    assert body["hero"]["title"] == "Everyday menswear, stocked deep."
    assert [h["title"] for h in body["highlights"]][0] == "Pick up in store"
    assert body["featured"]["enabled"] is False and body["featured_products"] == []


async def test_editing_the_site_and_featuring_products(client, fresh_client, create_product_with_stock, reset_content):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        live_id, _ = await create_product_with_stock(ac, unique, stock=3)
        draft = (
            await ac.post(
                "/products",
                json={
                    "name": f"Draft {unique}",
                    "slug": f"draft-{unique}",
                    "category_id": (await ac.get("/categories")).json()[0]["id"],
                    "base_price": 10,
                },
            )
        ).json()
        content = (await ac.get("/storefront")).json()["content"]
        content["hero"]["title"] = "Big end-of-year sale"
        content["announcement"]["text"] = "Free pickup all week"
        content["featured"] = {
            "enabled": True,
            "title": "Staff picks",
            "subtitle": "",
            "product_ids": [draft["id"], live_id],
        }
        saved = await ac.put("/storefront", json=content)
        assert saved.status_code == 200, saved.text
        assert saved.json()["updated_by_name"] == "Test Owner"
        log = (await ac.get("/reports/activity", params={"kind": "catalog"})).json()

    async with fresh_client() as shopper:
        public = (await shopper.get("/public/storefront")).json()
    assert public["hero"]["title"] == "Big end-of-year sale"
    assert public["announcement"]["text"] == "Free pickup all week"
    # Only the live product; trade prices never reach the public.
    assert [p["id"] for p in public["featured_products"]] == [live_id]
    assert public["featured_products"][0]["variants"][0]["wholesale_price"] is None
    assert any(e["summary"] == "Changed the website (announcement, banner, featured products)" for e in log)


async def test_links_must_be_pages_or_web_addresses(client, reset_content):
    async with client as ac:
        content = (await ac.get("/storefront")).json()["content"]
        content["hero"]["primary_link"] = "javascript:alert(1)"
        bad = await ac.put("/storefront", json=content)
        content["hero"]["primary_link"] = "/category/caps"
        content["social"]["instagram"] = "instagram.com/belpok"
        bad_social = await ac.put("/storefront", json=content)
        content["social"]["instagram"] = "https://instagram.com/belpok"
        good = await ac.put("/storefront", json=content)
    assert (bad.status_code, bad_social.status_code, good.status_code) == (422, 422, 200)


async def test_promo_visit_and_payment_methods(client, fresh_client, reset_content):
    async with client as ac:
        content = (await ac.get("/storefront")).json()["content"]
        # Defaults: no promotion until there's one to run; the usual payments.
        assert content["promo"]["enabled"] is False
        assert content["payment_methods"] == ["mobile_money", "cash", "card"]
        content["promo"].update({"enabled": True, "title": "Joggers week", "button_link": "/category/joggers"})
        content["visit"].update({"hours": "Mon–Sat: 8am – 7pm", "map_link": "https://maps.google.com/?q=Belin-Pok"})
        content["payment_methods"] = ["mobile_money", "cash"]
        assert (await ac.put("/storefront", json=content)).status_code == 200
        bad = dict(content, visit=dict(content["visit"], map_link="maps.google.com"))
        assert (await ac.put("/storefront", json=bad)).status_code == 422
        bad = dict(content, payment_methods=["cheque"])
        assert (await ac.put("/storefront", json=bad)).status_code == 422
    async with fresh_client() as shopper:
        public = (await shopper.get("/public/storefront")).json()
    assert public["promo"]["title"] == "Joggers week"
    assert public["visit"]["hours"] == "Mon–Sat: 8am – 7pm"
    assert public["payment_methods"] == ["mobile_money", "cash"]


async def test_category_photo(client, fresh_client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        made = (await ac.post("/categories", json={"name": f"Caps {unique}", "slug": f"caps-{unique}"})).json()
        assert made["image_path"] is None
        res = await ac.patch(f"/categories/{made['id']}", json={"image_path": "products/cap.jpg"})
        assert res.json()["image_path"] == "products/cap.jpg"
    async with fresh_client() as shopper:
        listed = (await shopper.get("/public/categories")).json()
    assert next(c for c in listed if c["id"] == made["id"])["image_path"] == "products/cap.jpg"
