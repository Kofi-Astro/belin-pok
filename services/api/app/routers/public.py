"""The public storefront catalog API: unauthenticated category/product
browsing, with search/price/sort/in-stock filtering. See the module-level
comment below for the hard status='active'/is_active=true filtering that
keeps this catalog customer-safe."""

from enum import StrEnum
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.models import Category, Product, ProductStatus, ProductVariant
from app.schemas import CategoryRead, ProductRead, ProductWithVariants

router = APIRouter(prefix="/public", tags=["public"])

# Unauthenticated storefront browsing. These never share a route with the
# staff-only endpoints in products.py/categories.py -- they hard-filter to
# status='active' products and is_active=true variants with no query
# parameter able to override that, so a public caller can never see a
# draft or archived product (or an inactive variant of an active one)
# regardless of what it asks for.


@router.get("/categories", response_model=list[CategoryRead])
async def list_public_categories(db: AsyncSession = Depends(get_db)) -> list[Category]:
    result = await db.scalars(select(Category).order_by(Category.display_order, Category.name))
    return list(result)


class ProductSort(StrEnum):
    name = "name"
    price_asc = "price_asc"
    price_desc = "price_desc"
    newest = "newest"


_SORT_COLUMNS = {
    ProductSort.name: (Product.name,),
    ProductSort.price_asc: (Product.base_price.asc(), Product.name),
    ProductSort.price_desc: (Product.base_price.desc(), Product.name),
    ProductSort.newest: (Product.created_at.desc(),),
}


@router.get("/products", response_model=list[ProductRead])
async def list_public_products(
    db: AsyncSession = Depends(get_db),
    category_id: UUID | None = None,
    search: str | None = Query(default=None, min_length=1, max_length=200),
    min_price: float | None = Query(default=None, ge=0),
    max_price: float | None = Query(default=None, ge=0),
    in_stock_only: bool = False,
    sort: ProductSort = ProductSort.name,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Product]:
    stmt = (
        select(Product)
        .where(Product.status == ProductStatus.active)
        .options(selectinload(Product.images))
        .order_by(*_SORT_COLUMNS[sort])
        .limit(limit)
        .offset(offset)
    )
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if search:
        stmt = stmt.where(Product.name.ilike(f"%{search}%"))
    if min_price is not None:
        stmt = stmt.where(Product.base_price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Product.base_price <= max_price)
    if in_stock_only:
        stmt = stmt.where(
            exists().where(
                ProductVariant.product_id == Product.id,
                ProductVariant.is_active.is_(True),
                ProductVariant.stock_quantity > 0,
            )
        )

    result = await db.scalars(stmt)
    return list(result)


@router.get("/products/{product_id}", response_model=ProductWithVariants)
async def get_public_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Product:
    stmt = (
        select(Product)
        .where(Product.id == product_id, Product.status == ProductStatus.active)
        .options(
            # Loader criteria on the relationship itself, not a Python-side
            # filter after loading -- an out-of-stock or discontinued
            # color/size variant just never shows up, same as the product
            # itself never showing up when it's draft/archived.
            selectinload(Product.variants.and_(ProductVariant.is_active.is_(True))),
            selectinload(Product.images),
        )
    )
    product = await db.scalar(stmt)
    if product is None:
        # Same 404 whether the product doesn't exist or merely isn't
        # active -- a public caller shouldn't be able to distinguish
        # "no such product" from "that product is a draft".
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product
