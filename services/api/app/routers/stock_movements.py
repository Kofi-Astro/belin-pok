import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import ProductVariant, Staff, StaffRole, StockMovement
from app.schemas import StockMovementCreate, StockMovementRead

router = APIRouter(prefix="/stock-movements", tags=["stock-movements"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)


@router.get("", response_model=list[StockMovementRead], dependencies=[Depends(get_current_staff)])
async def list_stock_movements(
    db: AsyncSession = Depends(get_db),
    variant_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[StockMovement]:
    stmt = select(StockMovement).order_by(StockMovement.created_at.desc()).limit(limit).offset(offset)
    if variant_id is not None:
        stmt = stmt.where(StockMovement.variant_id == variant_id)
    result = await db.scalars(stmt)
    return list(result)


@router.post("", response_model=StockMovementRead, status_code=status.HTTP_201_CREATED)
async def create_stock_movement(
    payload: StockMovementCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> StockMovement:
    # Lock the variant row for the rest of this transaction so two
    # concurrent movements on the same variant can't both pass this check
    # and take stock negative between them.
    variant = await db.scalar(
        select(ProductVariant).where(ProductVariant.id == payload.variant_id).with_for_update()
    )
    if variant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    if variant.stock_quantity + payload.quantity_change < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This movement would take the variant's stock below zero",
        )

    movement = StockMovement(**payload.model_dump(), performed_by=staff.id)
    db.add(movement)
    # A DB trigger (see supabase/migrations) applies quantity_change to
    # product_variants.stock_quantity as a defense-in-depth backstop; the
    # check above is what actually produces the friendly 409 for normal API
    # usage.
    await db.commit()
    await db.refresh(movement)
    return movement
