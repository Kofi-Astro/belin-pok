"""Product variants (size/color SKUs): staff-only CRUD plus the low-stock
list, and one storefront-facing endpoint (back-in-stock subscriptions) at
the bottom. See the module comment below on why stock_quantity has no
setter here."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_customer, get_current_staff, require_role
from app.models import Customer, Product, ProductVariant, StaffRole, StockNotificationRequest
from app.schemas import (
    LowStockVariantRead,
    ProductVariantCreate,
    ProductVariantRead,
    ProductVariantUpdate,
    StockNotificationRequestRead,
)

router = APIRouter(tags=["variants"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# stock_quantity is intentionally not settable here -- it's a cache kept in
# sync by a DB trigger on stock_movements (see supabase/migrations). Use
# POST /stock-movements to change it, so every change is audited.


def _generate_sku(product_slug: str, size: str, color: str | None) -> str:
    """PRODUCT-SLUG-SIZE[-COLOR], uppercased. Unique in practice because
    product.slug is itself unique and (product_id, size, color) is too --
    the DB's unique constraint on sku is still the real backstop, this
    just means staff never type one."""
    parts = [product_slug, size, *([color] if color else [])]
    sku = "-".join(parts).upper().replace(" ", "-")
    return sku[:100]


@router.get(
    "/products/{product_id}/variants",
    response_model=list[ProductVariantRead],
    dependencies=[Depends(get_current_staff)],
)
async def list_variants(product_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list[ProductVariant]:
    result = await db.scalars(
        select(ProductVariant).where(ProductVariant.product_id == product_id).order_by(ProductVariant.size)
    )
    return list(result)


@router.post(
    "/products/{product_id}/variants",
    response_model=ProductVariantRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_variant(
    product_id: uuid.UUID,
    payload: ProductVariantCreate,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> ProductVariant:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    data = payload.model_dump()
    if not data.get("sku"):
        data["sku"] = _generate_sku(product.slug, payload.size, payload.color)

    variant = ProductVariant(**data, product_id=product_id)
    db.add(variant)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SKU already exists, or this size/color combination already exists for this product",
        ) from exc
    await db.refresh(variant)
    return variant


@router.patch("/variants/{variant_id}", response_model=ProductVariantRead)
async def update_variant(
    variant_id: uuid.UUID,
    payload: ProductVariantUpdate,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> ProductVariant:
    variant = await db.get(ProductVariant, variant_id)
    if variant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SKU already exists, or this size/color combination already exists for this product",
        ) from exc
    await db.refresh(variant)
    return variant


@router.get(
    "/variants/low-stock",
    response_model=list[LowStockVariantRead],
    dependencies=[Depends(get_current_staff)],
)
async def low_stock_variants(db: AsyncSession = Depends(get_db)) -> list[LowStockVariantRead]:
    # Non-technical staff recognize a product by name/photo, not SKU --
    # this joins back to the product (and its images) so the inventory
    # screen can show both instead of a bare SKU.
    stmt = (
        select(ProductVariant)
        .where(ProductVariant.is_active.is_(True))
        .where(ProductVariant.stock_quantity <= ProductVariant.low_stock_threshold)
        .options(selectinload(ProductVariant.product).selectinload(Product.images))
        .order_by(ProductVariant.stock_quantity)
    )
    result = await db.scalars(stmt)
    return [
        LowStockVariantRead(
            **ProductVariantRead.model_validate(variant).model_dump(),
            product_name=variant.product.name,
            image_storage_path=next(
                (img.storage_path for img in variant.product.images if img.is_primary),
                variant.product.images[0].storage_path if variant.product.images else None,
            ),
        )
        for variant in result
    ]


# ---------- storefront ----------


@router.post(
    "/variants/{variant_id}/notify-when-in-stock",
    response_model=StockNotificationRequestRead,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe_to_back_in_stock(
    variant_id: uuid.UUID,
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> StockNotificationRequest:
    """"Notify me" on an out-of-stock variant. Idempotent while a
    subscription is still pending (the DB's partial unique index on
    (customer_id, variant_id) where notified_at is null backs this up --
    the check here is just what turns that into a friendly reuse instead
    of a 409). Once fulfilled (see the zero-crossing check in
    stock_movements.py), a customer is free to subscribe again next time
    it sells out.
    """
    variant = await db.get(ProductVariant, variant_id)
    if variant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    existing = await db.scalar(
        select(StockNotificationRequest).where(
            StockNotificationRequest.customer_id == customer.id,
            StockNotificationRequest.variant_id == variant_id,
            StockNotificationRequest.notified_at.is_(None),
        )
    )
    if existing is not None:
        return existing

    request = StockNotificationRequest(customer_id=customer.id, variant_id=variant_id)
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request
