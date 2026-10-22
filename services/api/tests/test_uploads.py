"""Photo upload/serve round trip. Runs against the in-memory store (no
S3_* settings in tests -- see app/storage.py's get_photo_store); the S3
store itself is a thin wrapper over boto3 and isn't exercised here."""

import pytest

from app.config import get_settings
from app.storage import MemoryPhotoStore, get_photo_store

# A few arbitrary bytes are enough: the API checks the declared content
# type and size, it doesn't decode the image.
_FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"photo-bytes" * 10


async def test_uploaded_photo_is_served_back_publicly_and_cacheably(client, fresh_client):
    async with client as ac:
        res = await ac.post(
            "/uploads/product-photo", files={"file": ("counter-shot.jpeg", _FAKE_JPEG, "image/jpeg")}
        )
    assert res.status_code == 201, res.text
    path = res.json()["storage_path"]
    # The extension comes from the content type, never the filename.
    assert path.startswith("products/") and path.endswith(".jpg")

    # No auth on the way back out -- the storefront shows these.
    async with fresh_client() as anonymous:
        image = await anonymous.get(f"/images/{path}")
    assert image.status_code == 200
    assert image.content == _FAKE_JPEG
    assert image.headers["content-type"] == "image/jpeg"
    assert "immutable" in image.headers["cache-control"]


async def test_upload_rejects_non_images_oversized_and_empty_files(client):
    async with client as ac:
        pdf = await ac.post("/uploads/product-photo", files={"file": ("x.pdf", b"%PDF-1.7", "application/pdf")})
        huge = await ac.post(
            "/uploads/product-photo", files={"file": ("big.png", b"\0" * (10 * 1024 * 1024 + 1), "image/png")}
        )
        empty = await ac.post("/uploads/product-photo", files={"file": ("e.png", b"", "image/png")})
    assert pdf.status_code == 415
    assert huge.status_code == 413
    assert empty.status_code == 400


async def test_upload_requires_signing_in(fresh_client):
    async with fresh_client() as ac:
        res = await ac.post("/uploads/product-photo", files={"file": ("x.jpg", _FAKE_JPEG, "image/jpeg")})
    assert res.status_code == 401


async def test_missing_image_is_a_404(fresh_client):
    async with fresh_client() as ac:
        res = await ac.get("/images/products/does-not-exist.jpg")
    assert res.status_code == 404


def test_in_memory_store_is_refused_outside_local_development(monkeypatch):
    """Without S3_* settings in production, every photo would vanish on the
    next deploy -- so that's a startup error, not a silent fallback."""
    settings = get_settings()
    get_photo_store.cache_clear()
    try:
        monkeypatch.setattr(settings, "environment", "production")
        with pytest.raises(RuntimeError, match="Photo storage isn't configured"):
            get_photo_store()

        monkeypatch.setattr(settings, "environment", "local")
        assert isinstance(get_photo_store(), MemoryPhotoStore)
    finally:
        # Leave the singleton exactly as other tests expect to find it.
        get_photo_store.cache_clear()
