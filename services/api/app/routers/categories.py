"""Staff-only category CRUD. Reads need any signed-in staff member; writes
(create/update/delete) are restricted to owner/inventory_manager. The
public, unauthenticated category listing customers see is a separate,
read-only endpoint in app/routers/public.py."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Category, StaffRole
from app.schemas import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# Where fast-received items (POST /products/receive) land when nobody has
# picked a category yet. Created on first use rather than seeded, so a
# shop that never uses that flow never sees an empty "Uncategorized";
# hidden from the public storefront's category list either way, and a
# product can't be published while it's still in here (see
# products.py's _check_publishable).
UNCATEGORIZED_SLUG = "uncategorized"


async def get_or_create_uncategorized(db: AsyncSession) -> Category:
    # ON CONFLICT DO NOTHING rather than select-then-insert, so two
    # first-ever receives racing each other can't both try to create it.
    await db.execute(
        insert(Category)
        .values(id=uuid.uuid4(), name="Uncategorized", slug=UNCATEGORIZED_SLUG, display_order=9999)
        .on_conflict_do_nothing(index_elements=["slug"])
    )
    return await db.scalar(select(Category).where(Category.slug == UNCATEGORIZED_SLUG))


@router.get("", response_model=list[CategoryRead], dependencies=[Depends(get_current_staff)])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[Category]:
    result = await db.scalars(select(Category).order_by(Category.display_order, Category.name))
    return list(result)


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> Category:
    category = Category(**payload.model_dump())
    db.add(category)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Category slug or name already exists"
        ) from exc
    await db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> Category:
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Category slug or name already exists"
        ) from exc
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _staff=Depends(_write_roles),
) -> None:
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    try:
        await db.delete(category)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is still referenced by products or child categories",
        ) from exc
