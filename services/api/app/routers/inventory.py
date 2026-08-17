from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_role
from app.models import AuditLog, ProductVariant, Staff, StaffRole
from app.schemas import RebalanceCreate, RebalanceLineResult, RebalanceResult

router = APIRouter(prefix="/inventory", tags=["inventory"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)


@router.post("/rebalance", response_model=RebalanceResult)
async def rebalance_inventory(
    payload: RebalanceCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> RebalanceResult:
    """Declares that some of a variant's on-hand stock has been organized
    into factory-style packs for shelf display -- a bookkeeping action, not
    a stock movement: the physical unit count on hand doesn't change (it's
    the same units, just now grouped), so stock_quantity is untouched and
    nothing goes through stock_movements. Recorded in audit_log instead,
    since "who repacked what, and when" is exactly what that table is for.
    """
    variant_ids = sorted({line.variant_id for line in payload.lines})
    variants: dict = {}
    for variant_id in variant_ids:
        variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
        if variant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Variant {variant_id} not found")
        variants[variant_id] = variant

    results: list[RebalanceLineResult] = []
    for line in payload.lines:
        variant = variants[line.variant_id]
        if variant.pack_size is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"SKU {variant.sku} has no pack_size configured",
            )
        units_needed = line.pack_count * variant.pack_size
        if variant.stock_quantity < units_needed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"SKU {variant.sku} only has {variant.stock_quantity} units on hand -- "
                    f"not enough for {line.pack_count} pack(s) of {variant.pack_size}"
                ),
            )

        db.add(
            AuditLog(
                staff_id=staff.id,
                action="inventory.rebalance",
                table_name="product_variants",
                record_id=variant.id,
                new_values={
                    "pack_count": line.pack_count,
                    "pack_size": variant.pack_size,
                    "units_packed": units_needed,
                    "note": payload.note,
                },
            )
        )
        results.append(
            RebalanceLineResult(
                variant_id=variant.id,
                sku=variant.sku,
                pack_count=line.pack_count,
                units_packed=units_needed,
                stock_quantity=variant.stock_quantity,
            )
        )

    await db.commit()
    return RebalanceResult(lines=results)
