import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Product, ProductImage, StaffRole
from app.schemas import ProductImageCreate, ProductImageRead

router = APIRouter(tags=["product-images"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# The actual file bytes go straight from the admin app to Supabase Storage
# (the `product-images` bucket, using the signed-in staff member's own
# session -- see supabase/migrations for the storage.objects RLS policies
# that restrict that to staff). This API only ever handles the resulting
# `product_images` row, given the storage path the upload landed at.


@router.post(
    "/products/{product_id}/images",
    response_model=ProductImageRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_product_image(
    product_id: uuid.UUID,
    payload: ProductImageCreate,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> ProductImage:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if payload.is_primary:
        await db.execute(
            update(ProductImage).where(ProductImage.product_id == product_id).values(is_primary=False)
        )

    image = ProductImage(product_id=product_id, **payload.model_dump())
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


@router.patch("/images/{image_id}", response_model=ProductImageRead)
async def set_primary_image(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> ProductImage:
    """Makes this image the product's primary/cover photo."""
    image = await db.get(ProductImage, image_id)
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    await db.execute(
        update(ProductImage).where(ProductImage.product_id == image.product_id).values(is_primary=False)
    )
    image.is_primary = True
    await db.commit()
    await db.refresh(image)
    return image


@router.delete("/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_image(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> None:
    image = await db.get(ProductImage, image_id)
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    await db.delete(image)
    await db.commit()


@router.get(
    "/products/{product_id}/images",
    response_model=list[ProductImageRead],
    dependencies=[Depends(get_current_staff)],
)
async def list_product_images(product_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list[ProductImage]:
    result = await db.scalars(
        select(ProductImage)
        .where(ProductImage.product_id == product_id)
        .order_by(ProductImage.display_order)
    )
    return list(result)
