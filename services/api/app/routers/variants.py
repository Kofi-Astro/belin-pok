"""Product variants (size/color SKUs): staff-only CRUD plus the low-stock
list, and one storefront-facing endpoint (back-in-stock subscriptions) at
the bottom. See the module comment below on why stock_quantity has no
setter here."""

import enum
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_customer, get_current_staff, require_role
from app.models import Category, Customer, Product, ProductVariant, StaffRole, StockNotificationRequest
from app.schemas import (
    InventoryVariantRead,
    LowStockVariantRead,
    ProductVariantCreate,
    ProductVariantRead,
    ProductVariantUpdate,
    StockNotificationRequestRead,
)

router = APIRouter(tags=["variants"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# stock_quantity is intentionally not settable here -- it's a cache kept in
# sync by a DB trigger on stock_movements (see migrations/). Use
# POST /stock-movements to change it, so every change is audited.


def generate_sku(product_slug: str, size: str, color: str | None, style: str | None = None) -> str:
    """PRODUCT-SLUG[-TYPE]-SIZE[-COLOR], uppercased. Unique in practice
    because product.slug is itself unique and (product_id, type, size,
    color) is too --
    the DB's unique constraint on sku is still the real backstop, this
    just means staff never type one."""
    parts = [product_slug, *([style] if style else []), size, *([color] if color else [])]
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
        data["sku"] = generate_sku(product.slug, payload.size, payload.color, payload.style)

    variant = ProductVariant(**data, product_id=product_id)
    db.add(variant)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SKU already exists, or this type, size and colour already exists for this product",
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
            detail="SKU already exists, or this type, size and colour already exists for this product",
        ) from exc
    await db.refresh(variant)
    return variant


class StockLevel(enum.StrEnum):
    """Filters for the stock table. "low" means at or under the variant's
    own low_stock_threshold but not zero -- matching what
    /variants/low-stock and the dashboard's low-stock count call low,
    minus the sold-out ones, which get their own filter."""

    in_stock = "in_stock"
    low = "low"
    out = "out"


def _primary_image_path(product: Product) -> str | None:
    primary = next((img for img in product.images if img.is_primary), None)
    if primary is None and product.images:
        primary = product.images[0]
    return primary.storage_path if primary else None


@router.get("/variants", response_model=list[InventoryVariantRead], dependencies=[Depends(get_current_staff)])
async def list_inventory(
    response: Response,
    db: AsyncSession = Depends(get_db),
    search: str | None = Query(default=None, min_length=1, max_length=200),
    category_id: uuid.UUID | None = None,
    stock: StockLevel | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[InventoryVariantRead]:
    """Every SKU across the catalog with its stock level -- the admin's
    main inventory table. Search matches the product name or the SKU.
    Archived products' variants are left out (they're discontinued, not
    stock to manage); drafts are included, since a freshly received item
    is a draft until it's priced. X-Total-Count carries the total."""
    stmt = (
        select(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(Product.status != "archived")
    )
    if not include_inactive:
        stmt = stmt.where(ProductVariant.is_active.is_(True))
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(or_(Product.name.ilike(pattern), ProductVariant.sku.ilike(pattern)))
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if stock == StockLevel.out:
        stmt = stmt.where(ProductVariant.stock_quantity == 0)
    elif stock == StockLevel.low:
        stmt = stmt.where(
            ProductVariant.stock_quantity > 0,
            ProductVariant.stock_quantity <= ProductVariant.low_stock_threshold,
        )
    elif stock == StockLevel.in_stock:
        stmt = stmt.where(ProductVariant.stock_quantity > ProductVariant.low_stock_threshold)

    response.headers["X-Total-Count"] = str(await db.scalar(select(func.count()).select_from(stmt.subquery())))
    variants = await db.scalars(
        stmt.options(selectinload(ProductVariant.product).selectinload(Product.images))
        .order_by(Product.name, ProductVariant.style, ProductVariant.size, ProductVariant.color)
        .limit(limit)
        .offset(offset)
    )
    variants = list(variants)
    category_names = dict(
        (
            await db.execute(
                select(Category.id, Category.name).where(Category.id.in_({v.product.category_id for v in variants}))
            )
        ).all()
    )
    return [
        InventoryVariantRead(
            **ProductVariantRead.model_validate(v).model_dump(),
            product_name=v.product.name,
            product_status=v.product.status,
            category_id=v.product.category_id,
            category_name=category_names.get(v.product.category_id, ""),
            image_storage_path=_primary_image_path(v.product),
        )
        for v in variants
    ]


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
            image_storage_path=_primary_image_path(variant.product),
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
    """ "Notify me" on an out-of-stock variant. Idempotent while a
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
