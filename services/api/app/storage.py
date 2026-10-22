"""Where product photos live: an S3-compatible bucket in production (a
Railway Bucket), or an in-memory stand-in for local development and
tests.

Photos travel *through the API* in both directions (see
app/routers/uploads.py) rather than the apps talking to the bucket
directly. That costs the API some bandwidth, but it means:

- No bucket-side CORS setup. A browser uploading straight to a bucket,
  or Flutter web loading an image straight from one, needs CORS headers
  configured on the bucket itself; through the API, the existing
  CORS_ORIGINS setting already covers it.
- The bucket can stay private. Nothing but this module ever holds its
  credentials -- the apps only ever see storage paths like
  "products/<uuid>.jpg" and load them via GET /images/{path}.
- Swapping storage providers later touches only this file.
"""

import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class StoredPhoto:
    data: bytes
    content_type: str


class PhotoStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> StoredPhoto | None:
        """None if nothing is stored under this key."""
        ...


class S3PhotoStore:
    """Any S3-compatible bucket. boto3 is synchronous, so each call runs in
    a worker thread instead of blocking the event loop."""

    def __init__(self, *, endpoint_url: str, bucket: str, access_key_id: str, secret_access_key: str, region: str):
        # Imported here so the dependency is only needed where S3 is
        # actually configured -- not for local dev or tests.
        import boto3

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self._client.put_object, Bucket=self._bucket, Key=key, Body=data, ContentType=content_type
        )

    async def get(self, key: str) -> StoredPhoto | None:
        from botocore.exceptions import ClientError

        try:
            obj = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        data = await asyncio.to_thread(obj["Body"].read)
        return StoredPhoto(data=data, content_type=obj.get("ContentType") or "application/octet-stream")


class MemoryPhotoStore:
    """Keeps photos in this process's memory: lost on restart, never shared
    between processes. Only for local development and tests -- see
    get_photo_store for the guard that keeps it out of production."""

    def __init__(self) -> None:
        self._photos: dict[str, StoredPhoto] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self._photos[key] = StoredPhoto(data=data, content_type=content_type)

    async def get(self, key: str) -> StoredPhoto | None:
        return self._photos.get(key)


@lru_cache
def get_photo_store() -> PhotoStore:
    """FastAPI dependency (and a process-wide singleton). Uses the bucket
    when S3_* settings are present. Without them, falls back to memory --
    but only when ENVIRONMENT is "local"; anywhere else that's a
    misconfiguration that would silently lose every photo on the next
    deploy, so it fails loudly instead."""
    settings = get_settings()
    s3_settings = (
        settings.s3_endpoint_url,
        settings.s3_bucket,
        settings.s3_access_key_id,
        settings.s3_secret_access_key,
    )
    if all(s3_settings):
        return S3PhotoStore(
            endpoint_url=settings.s3_endpoint_url,
            bucket=settings.s3_bucket,
            access_key_id=settings.s3_access_key_id,
            secret_access_key=settings.s3_secret_access_key,
            region=settings.s3_region,
        )
    if settings.environment != "local":
        raise RuntimeError(
            "Photo storage isn't configured: set S3_ENDPOINT_URL, S3_BUCKET, S3_ACCESS_KEY_ID and "
            "S3_SECRET_ACCESS_KEY (or ENVIRONMENT=local to use the in-memory store for development)"
        )
    logger.warning("S3_* not set -- storing photos in memory (development only; lost on restart)")
    return MemoryPhotoStore()
