import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Order, OrderStatus, OrderStatusHistory, Staff, StaffRole
from app.schemas import OrderStatusUpdate, OrderWithItems

router = APIRouter(prefix="/orders", tags=["orders"])

_write_roles = require_role(StaffRole.owner, StaffRole.order_fulfillment)

# Order creation (with line items, price snapshotting, and the resulting
# stock_movements) isn't exposed yet -- it belongs with the checkout flow
# that Phase 2 (storefront/wholesale ordering) introduces. For Phase 1,
# orders are expected to be listed and progressed through fulfillment here.


@router.get("", response_model=list[OrderWithItems], dependencies=[Depends(get_current_staff)])
async def list_orders(
    db: AsyncSession = Depends(get_db),
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    customer_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Order]:
    stmt = (
        select(Order)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if status_filter is not None:
        stmt = stmt.where(Order.status == status_filter)
    if customer_id is not None:
        stmt = stmt.where(Order.customer_id == customer_id)
    result = await db.scalars(stmt)
    return list(result)


@router.get("/{order_id}", response_model=OrderWithItems, dependencies=[Depends(get_current_staff)])
async def get_order(order_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Order:
    stmt = select(Order).where(Order.id == order_id).options(selectinload(Order.items))
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


@router.post("/{order_id}/status", response_model=OrderWithItems)
async def update_order_status(
    order_id: uuid.UUID,
    payload: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> Order:
    order = await db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    order.status = payload.status
    db.add(OrderStatusHistory(order_id=order.id, status=payload.status, changed_by=staff.id, note=payload.note))

    await db.commit()

    stmt = select(Order).where(Order.id == order_id).options(selectinload(Order.items))
    return await db.scalar(stmt)
