import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import AuditLog, Product, ProductStatus, Staff, StaffRole
from app.schemas import ProductCreate, ProductRead, ProductUpdate, ProductWithVariants

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
