"""Product photo bytes in and out (see app/storage.py for where they're
kept, and why they go through the API at all).

Uploading only stores the file and returns its storage path; attaching it
to a product is a separate step that already existed -- POST
/products/{id}/images with that path, or image_storage_path on POST
/products/receive. That split lets the receive-stock form upload the
photo the moment it's taken, before the product it belongs to exists.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app.deps import require_role
from app.models import StaffRole
from app.storage import PhotoStore, get_photo_store

router = APIRouter(tags=["uploads"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# Phone photos after the apps' own compression (imageQuality: 88) are
# typically well under 2 MB; this leaves plenty of room while still
# refusing anything that clearly isn't a product photo.
_MAX_PHOTO_BYTES = 10 * 1024 * 1024

# Formats every browser and both Flutter apps can display. The file
# extension in the storage path comes from here, never from the uploaded
# filename, so a path can't be used to smuggle in some other file type.
_ALLOWED_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class PhotoUploadRead(BaseModel):
    storage_path: str


@router.post("/uploads/product-photo", response_model=PhotoUploadRead, status_code=status.HTTP_201_CREATED)
async def upload_product_photo(
    file: UploadFile,
    store: PhotoStore = Depends(get_photo_store),
    _staff=Depends(_write_roles),
) -> PhotoUploadRead:
    extension = _ALLOWED_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload a JPEG, PNG or WebP photo",
        )
    # Read one byte past the limit, so an oversized file is detected
    # without ever holding more than that in memory.
    data = await file.read(_MAX_PHOTO_BYTES + 1)
    if len(data) > _MAX_PHOTO_BYTES:
        # 413 as a plain number: Starlette renamed its constant between versions.
        raise HTTPException(status_code=413, detail="That photo is over 10 MB")
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")

    # A fresh random key per upload: nothing is ever overwritten, which is
    # also what makes the long-lived caching on GET /images safe.
    storage_path = f"products/{uuid.uuid4()}.{extension}"
    await store.put(storage_path, data, file.content_type)
    return PhotoUploadRead(storage_path=storage_path)


@router.get("/images/{storage_path:path}")
async def get_image(storage_path: str, store: PhotoStore = Depends(get_photo_store)) -> Response:
    """Public, like the photos themselves on the storefront -- no sign-in
    needed. Storage paths are random UUIDs, so they can't be enumerated."""
    photo = await store.get(storage_path)
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return Response(
        content=photo.data,
        media_type=photo.content_type,
        # Every path is written exactly once (see upload_product_photo), so
        # browsers and any CDN in front can cache it forever.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
