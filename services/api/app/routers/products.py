import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Product, ProductStatus, Staff, StaffRole
from app.schemas import ProductCreate, ProductRead, ProductUpdate, ProductWithVariants

router = APIRouter(prefix="/products", tags=["products"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# Products are never hard-deleted via the API -- "archive" means
# PATCH /products/{id} with {"status": "archived"}, which keeps order
# history, stock history, and images intact.


@router.get("", response_model=list[ProductRead], dependencies=[Depends(get_current_staff)])
async def list_products(
    db: AsyncSession = Depends(get_db),
    category_id: uuid.UUID | None = None,
    status_filter: ProductStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Product]:
    stmt = select(Product).order_by(Product.created_at.desc()).limit(limit).offset(offset)
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
    stmt = select(Product).where(Product.id == product_id).options(selectinload(Product.variants))
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
    await db.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductRead)
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_write_roles),
) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product slug already exists") from exc
    await db.refresh(product)
    return product
