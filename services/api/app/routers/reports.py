from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_role
from app.models import Product, ProductVariant, Staff, StaffRole, StockMovement, StockMovementType
from app.schemas import DailySalesRead

router = APIRouter(prefix="/reports", tags=["reports"])

_read_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)


@router.get("/daily-sales", response_model=list[DailySalesRead])
async def daily_sales(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_read_roles),
    days: int = Query(default=30, ge=1, le=365),
) -> list[DailySalesRead]:
    """One row per day with at least one sale, newest first. Covers every
    'sale' stock movement regardless of where it came from -- a walk-in
    sale logged on the spot by staff and a storefront checkout both go
    through the same stock_movements table (see app/routers/orders.py and
    app/routers/stock_movements.py), so this needs only one source to
    cover both. Revenue is quantity x each item's *current* price, not a
    price snapshot from the moment of sale -- simple, and accurate enough
    unless prices are changing day to day.
    """
    unit_price = func.coalesce(ProductVariant.price_override, Product.base_price)
    sale_day = func.date(StockMovement.created_at)
    stmt = (
        select(
            sale_day.label("day"),
            func.sum(-StockMovement.quantity_change).label("items_sold"),
            func.sum(unit_price * -StockMovement.quantity_change).label("total_amount"),
        )
        .join(ProductVariant, ProductVariant.id == StockMovement.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(StockMovement.movement_type == StockMovementType.sale)
        .group_by(sale_day)
        .order_by(sale_day.desc())
        .limit(days)
    )
    rows = (await db.execute(stmt)).all()
    return [
        DailySalesRead(day=row.day, items_sold=int(row.items_sold), total_amount=float(row.total_amount))
        for row in rows
    ]
