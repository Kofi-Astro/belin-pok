"""Staff-only product CRUD (create/update/delete/list, including drafts and
archived products). Every write is mirrored into audit_log. The public,
unauthenticated product catalog customers browse is a separate endpoint
in app/routers/public.py that only ever shows status='active' products."""

import re
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import (
    AuditLog,
    Category,
    Product,
    ProductImage,
    ProductStatus,
    ProductVariant,
    Staff,
    StaffRole,
    StockMovement,
    StockMovementType,
)
from app.routers.categories import UNCATEGORIZED_SLUG, get_or_create_uncategorized
from app.routers.stock_movements import notify_back_in_stock_subscribers
from app.routers.variants import generate_sku
from app.schemas import (
    ProductCreate,
    ProductRead,
    ProductUpdate,
    ProductVariantRead,
    ProductWithVariants,
    StockIntakeCreate,
    StockIntakeRead,
)

router = APIRouter(prefix="/products", tags=["products"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# Products are never hard-deleted via the API -- "archive" means
# PATCH /products/{id} with {"status": "archived"}, which keeps order
# history, stock history, and images intact.


def _snapshot(product: Product) -> dict:
    """The editable fields, JSON-safe -- what audit_log.old_values/
    new_values actually compares, not the full ORM object (images/variants
    are their own resources with their own history, not "the product"
    changing)."""
    return {
        "name": product.name,
        "slug": product.slug,
        "description": product.description,
        "category_id": str(product.category_id),
        "brand": product.brand,
        "base_price": float(product.base_price),
        "status": product.status.value,
        "primary_supplier_id": str(product.primary_supplier_id) if product.primary_supplier_id else None,
    }


async def _check_publishable(db: AsyncSession, product: Product) -> None:
    """The gate between a fast-received placeholder (see receive_stock)
    and something customers or the till can actually sell: no ₵0 price,
    no "Uncategorized". Only applied when a product is going active, so
    drafts can stay incomplete for as long as they need to."""
    if product.status != ProductStatus.active:
        return
    if float(product.base_price) <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Set a price for this product before publishing it"
        )
    category = await db.get(Category, product.category_id)
    if category is not None and category.slug == UNCATEGORIZED_SLUG:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pick a category for this product before publishing it"
        )


@router.get("", response_model=list[ProductRead], dependencies=[Depends(get_current_staff)])
async def list_products(
    db: AsyncSession = Depends(get_db),
    category_id: uuid.UUID | None = None,
    status_filter: ProductStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Product]:
    stmt = (
        select(Product)
        .options(selectinload(Product.images))
        .order_by(Product.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if status_filter is not None:
        stmt = stmt.where(Product.status == status_filter)
    if search:
        stmt = stmt.where(Product.name.ilike(f"%{search}%"))

    result = await db.scalars(stmt)
    return list(result)


@router.get("/{product_id}", response_model=ProductWithVariants)
async def get_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(get_current_staff),
) -> Product:
    stmt = (
        select(Product)
        .where(Product.id == product_id)
        .options(selectinload(Product.variants), selectinload(Product.images))
    )
    product = await db.scalar(stmt)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> Product:
    product = Product(**payload.model_dump(), created_by=staff.id)
    await _check_publishable(db, product)
    db.add(product)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Product slug already exists, or category_id/primary_supplier_id does not exist",
        ) from exc

    db.add(
        AuditLog(
            staff_id=staff.id,
            action="product.create",
            table_name="products",
            record_id=product.id,
            new_values=_snapshot(product),
        )
    )
    await db.commit()

    # A plain refresh() (or assigning product.images directly) expires/needs
    # to inspect the `images` relationship, which triggers a lazy DB load
    # outside of an active async greenlet context and raises MissingGreenlet.
    # Re-fetching with explicit eager loading sidesteps that entirely.
    stmt = select(Product).where(Product.id == product.id).options(selectinload(Product.images))
    return await db.scalar(stmt)


# What a fast-received item gets for anything staff didn't fill in at the
# counter. "One Size" is already the shop's own wording for caps/socks,
# so for many items the placeholder variant is simply correct as-is.
DEFAULT_RECEIVE_SIZE = "One Size"


async def _unique_slug(db: AsyncSession, name: str) -> str:
    """Staff never type a slug on the fast path, and two deliveries can
    easily both be called "Black Tee" -- so on a clash, add a short random
    suffix instead of failing the whole receive."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:280] or "item"
    slug = base
    while await db.scalar(select(Product.id).where(Product.slug == slug)) is not None:
        slug = f"{base}-{uuid.uuid4().hex[:4]}"
    return slug


@router.post("/receive", response_model=StockIntakeRead, status_code=status.HTTP_201_CREATED)
async def receive_stock(
    payload: StockIntakeCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> StockIntakeRead:
    """Logs goods coming in, in one transaction -- the fast path for a
    delivery at the counter. For a brand-new item (no product_id) this
    creates the product, its photo, a variant, and the stock movement
    together; only name/photo/quantity are required, and the rest falls
    back to placeholders that keep it unsellable until reviewed:

    - category: "Uncategorized" (see categories.get_or_create_uncategorized)
    - base_price: 0.00 -- and status is always 'draft', so neither the
      storefront nor the POS will sell it, and _check_publishable won't
      let it go active until both of those are replaced with real values
    - size: DEFAULT_RECEIVE_SIZE; SKU auto-generated as usual

    With product_id, it's more stock for an item already in the catalog:
    the matching size/color variant gets a restock movement, or is created
    first if that size/color is new for this product.

    Same shape as orders.py's checkout(): flush() for ids along the way,
    one commit at the end, so a failure anywhere leaves nothing behind.
    """
    created_product = False
    if payload.product_id is not None:
        product = await db.get(Product, payload.product_id)
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    else:
        if payload.category_id is not None:
            if await db.get(Category, payload.category_id) is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
            category_id = payload.category_id
        else:
            category_id = (await get_or_create_uncategorized(db)).id

        product = Product(
            name=payload.name,
            slug=await _unique_slug(db, payload.name),
            category_id=category_id,
            base_price=payload.base_price if payload.base_price is not None else 0,
            status=ProductStatus.draft,
            created_by=staff.id,
        )
        db.add(product)
        await db.flush()
        db.add(ProductImage(product_id=product.id, storage_path=payload.image_storage_path, is_primary=True))
        created_product = True

    size = payload.size or DEFAULT_RECEIVE_SIZE
    color_match = (
        ProductVariant.color.is_(None) if payload.color is None else ProductVariant.color == payload.color
    )
    # Locked for the same reason create_stock_movement locks it: the
    # zero-crossing check below needs an old quantity nobody else can
    # change underneath it.
    variant = await db.scalar(
        select(ProductVariant)
        .where(ProductVariant.product_id == product.id, ProductVariant.size == size, color_match)
        .with_for_update()
    )
    created_variant = variant is None
    if created_variant:
        variant = ProductVariant(
            product_id=product.id,
            sku=generate_sku(product.slug, size, payload.color),
            size=size,
            color=payload.color,
        )
        db.add(variant)
        await db.flush()

    old_quantity = variant.stock_quantity
    db.add(
        StockMovement(
            variant_id=variant.id,
            movement_type=StockMovementType.initial if created_variant else StockMovementType.restock,
            quantity_change=payload.quantity,
            reason=payload.reason,
            performed_by=staff.id,
        )
    )
    if created_product:
        db.add(
            AuditLog(
                staff_id=staff.id,
                action="product.create",
                table_name="products",
                record_id=product.id,
                new_values=_snapshot(product),
            )
        )

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Couldn't save this item -- its generated SKU already exists. Try a slightly different name.",
        ) from exc

    if old_quantity == 0 and not created_variant:
        await notify_back_in_stock_subscribers(db, variant.id, background_tasks)

    # Re-fetched rather than refresh()ed, for the same MissingGreenlet
    # reason as create_product -- and so stock_quantity reflects what the
    # apply_stock_movement trigger just wrote.
    product = await db.scalar(
        select(Product)
        .where(Product.id == product.id)
        .options(selectinload(Product.variants), selectinload(Product.images))
        .execution_options(populate_existing=True)
    )
    variant = next(v for v in product.variants if v.id == variant.id)
    return StockIntakeRead(
        product=ProductWithVariants.model_validate(product),
        variant=ProductVariantRead.model_validate(variant),
        created_product=created_product,
        created_variant=created_variant,
    )


@router.patch("/{product_id}", response_model=ProductRead)
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> Product:
    stmt = select(Product).where(Product.id == product_id).options(selectinload(Product.images))
    product = await db.scalar(stmt)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    before = _snapshot(product)
    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(product, field, value)
    if before["status"] != ProductStatus.active.value:
        await _check_publishable(db, product)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product slug already exists") from exc

    if changed_fields:
        after = _snapshot(product)
        db.add(
            AuditLog(
                staff_id=staff.id,
                action="product.update",
                table_name="products",
                record_id=product.id,
                old_values={k: before[k] for k in changed_fields if k in before},
                new_values={k: after[k] for k in changed_fields if k in after},
            )
        )
        await db.commit()

    # Re-fetching (rather than refresh()) sidesteps refresh() expiring the
    # already-eager-loaded `images` relationship -- accessing an expired
    # relationship triggers a lazy DB load outside of an active async
    # greenlet context and raises MissingGreenlet.
    stmt = select(Product).where(Product.id == product_id).options(selectinload(Product.images))
    return await db.scalar(stmt)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> None:
    """A real delete, not just archiving -- but only actually possible for
    a product nothing has ever referenced. Every variant's stock_movements
    and order_items rows are ON DELETE RESTRICT (see supabase/migrations),
    so the moment a product has any sales/stock history this fails with an
    IntegrityError instead of silently destroying that history; archiving
    (PATCH status='archived') is what discontinuing an actually-sold
    product should use instead.
    """
    stmt = (
        select(Product)
        .where(Product.id == product_id)
        .options(selectinload(Product.variants), selectinload(Product.images))
    )
    product = await db.scalar(stmt)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    before = _snapshot(product)
    await db.delete(product)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This product has order or stock history and can't be deleted -- archive it instead.",
        ) from exc

    db.add(
        AuditLog(
            staff_id=staff.id,
            action="product.delete",
            table_name="products",
            record_id=product_id,
            old_values=before,
        )
    )
    await db.commit()
