"""Drafting descriptions from photos (app/ai_describe.py and POST
/products/{id}/describe). Claude itself is replaced by a fake client, so
these check what's sent and how replies are handled -- no API calls."""

import base64
import io
import json
import uuid
from types import SimpleNamespace

import pytest
from PIL import Image

from app import ai_describe
from app.config import get_settings


def _photo(width=3000, height=2000) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (30, 30, 40)).save(out, format="PNG")
    return out.getvalue()


class _FakeClient:
    """Stands in for anthropic.AsyncAnthropic; records the request."""

    last_request: dict = {}
    reply = SimpleNamespace(
        stop_reason="end_turn",
        content=[
            SimpleNamespace(
                type="text", text=json.dumps({"description": "A black pullover hoodie.", "colour": "Black"})
            )
        ],
    )

    def __init__(self, **kwargs):
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    async def _create(self, **request):
        _FakeClient.last_request = request
        return _FakeClient.reply


@pytest.fixture
def claude(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    monkeypatch.setattr(ai_describe.anthropic, "AsyncAnthropic", _FakeClient)
    return _FakeClient


async def test_draft_sends_a_shrunk_photo_and_the_facts(claude):
    draft = await ai_describe.draft_description(_photo(), ["Name: Joggers", "Types / qualities: Standard, Premium"])
    assert (draft.description, draft.colour) == ("A black pullover hoodie.", "Black")

    req = claude.last_request
    assert req["model"] == "claude-opus-5-5"
    assert req["fallbacks"] == "default" and req["betas"] == ["server-side-fallback-2026-07-01"]
    assert req["output_config"]["format"]["type"] == "json_schema"
    image, text = req["messages"][0]["content"]
    assert image["source"]["media_type"] == "image/jpeg"
    sent = Image.open(io.BytesIO(base64.b64decode(image["source"]["data"])))
    assert max(sent.size) == 1568  # shrunk from 3000 px
    assert "Types / qualities: Standard, Premium" in text["text"]


async def test_a_refusal_becomes_a_clear_message(claude, monkeypatch):
    monkeypatch.setattr(claude, "reply", SimpleNamespace(stop_reason="refusal", content=[]))
    with pytest.raises(ai_describe.DescriptionUnavailable, match="write it yourself"):
        await ai_describe.draft_description(_photo(400, 400), ["Name: Cap"])


async def test_not_set_up_without_a_key(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    with pytest.raises(ai_describe.DescriptionUnavailable, match="isn't set up"):
        await ai_describe.draft_description(_photo(400, 400), ["Name: Cap"])


async def test_describe_endpoint(client, claude, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, _ = await create_product_with_stock(ac, unique, stock=1)
        no_photo = await ac.post(f"/products/{product_id}/describe")
        assert no_photo.status_code == 409

        upload = await ac.post("/uploads/product-photo", files={"file": ("p.png", _photo(800, 800), "image/png")})
        await ac.post(
            f"/products/{product_id}/images", json={"storage_path": upload.json()["storage_path"], "is_primary": True}
        )
        res = await ac.post(f"/products/{product_id}/describe")
        assert res.status_code == 200, res.text
        assert res.json() == {"description": "A black pullover hoodie.", "colour": "Black"}
        # A draft only: the product's description is untouched.
        assert (await ac.get(f"/products/{product_id}")).json()["description"] is None
    facts = claude.last_request["messages"][0]["content"][1]["text"]
    assert f"Name: Item {unique}" in facts and f"Category: Cat {unique}" in facts


async def test_describe_endpoint_when_not_set_up(client, create_product_with_stock, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        product_id, _ = await create_product_with_stock(ac, unique, stock=1)
        upload = await ac.post("/uploads/product-photo", files={"file": ("p.png", _photo(200, 200), "image/png")})
        await ac.post(
            f"/products/{product_id}/images", json={"storage_path": upload.json()["storage_path"], "is_primary": True}
        )
        res = await ac.post(f"/products/{product_id}/describe")
    assert res.status_code == 503
    assert "ANTHROPIC_API_KEY" in res.json()["detail"]
