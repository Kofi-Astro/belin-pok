"""The append-only stock ledger: every restock, sale, correction, and
return is a row here (see StockMovement in app/models.py), and
stock_quantity on product_variants is a cache kept in sync by a DB
trigger, not edited directly through this API. Also where back-in-stock
push notifications get triggered, the moment a variant's stock crosses
from zero to positive."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.erase import record_deletion, remove_movement
from app.models import (
    CustomerDeviceToken,
    Product,
    ProductVariant,
    Staff,
    StaffRole,
    StockMovement,
    StockNotificationRequest,
)
from app.push import send_push
from app.schemas import StockMovementCreate, StockMovementRead

router = APIRouter(prefix="/stock-movements", tags=["stock-movements"])

# Order Fulfillment can log the walk-in sales/corrections that happen at
# the counter; Owner and Inventory Manager retain full control. Viewer
# stays read-only, matching its name.
_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager, StaffRole.order_fulfillment)
_owner = require_role(StaffRole.owner)

# Movements made by a sale or an order belong to that record: they're
# removed with it (DELETE /pos-sales/{id}, DELETE /orders/{id}), never on
# their own, or the sale and the stock would stop agreeing.
_OWNED_BY = {
    "pos_sale": "till sale",
    "pos_sale_void": "till sale",
    "order": "online order",
    "order_cancel": "online order",
}


@router.get("", response_model=list[StockMovementRead], dependencies=[Depends(get_current_staff)])
async def list_stock_movements(
    db: AsyncSession = Depends(get_db),
    variant_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[StockMovementRead]:
    # Joined in (rather than modeled as relationships on StockMovement) so
    # the Inventory screen's activity feed can show what/who without a
    # second round trip per row -- this is the only place that needs it.
    unit_price = func.coalesce(ProductVariant.price_override, Product.base_price)
    stmt = (
        select(
            StockMovement,
            Product.name.label("product_name"),
            ProductVariant.sku.label("variant_sku"),
            ProductVariant.size.label("variant_size"),
            ProductVariant.color.label("variant_color"),
            Staff.full_name.label("performed_by_name"),
            Staff.roles.label("performed_by_roles"),
            unit_price.label("unit_price"),
        )
        .join(ProductVariant, ProductVariant.id == StockMovement.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .outerjoin(Staff, Staff.id == StockMovement.performed_by)
        .order_by(StockMovement.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if variant_id is not None:
        stmt = stmt.where(StockMovement.variant_id == variant_id)
    rows = (await db.execute(stmt)).all()
    return [
        StockMovementRead.model_validate(row.StockMovement).model_copy(
            update={
                "product_name": row.product_name,
                "variant_sku": row.variant_sku,
                "variant_size": row.variant_size,
                "variant_color": row.variant_color,
                "performed_by_name": row.performed_by_name,
                # The most senior role, as one label for the activity feed.
                "performed_by_role": next(
                    (
                        r
                        for r in ("owner", "inventory_manager", "order_fulfillment", "viewer")
                        if r in (row.performed_by_roles or [])
                    ),
                    None,
                ),
                "unit_price": float(row.unit_price),
            }
        )
        for row in rows
    ]


@router.post("", response_model=StockMovementRead, status_code=status.HTTP_201_CREATED)
async def create_stock_movement(
    payload: StockMovementCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> StockMovement:
    # Lock the variant row for the rest of this transaction so two
    # concurrent movements on the same variant can't both pass this check
    # and take stock negative between them.
    variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == payload.variant_id).with_for_update())
    if variant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    old_quantity = variant.stock_quantity
    new_quantity = old_quantity + payload.quantity_change
    if new_quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This movement would take the variant's stock below zero",
        )

    movement = StockMovement(**payload.model_dump(), performed_by=staff.id)
    db.add(movement)
    # A DB trigger (see migrations/) applies quantity_change to
    # product_variants.stock_quantity as a defense-in-depth backstop; the
    # check above is what actually produces the friendly 409 for normal API
    # usage.
    await db.commit()
    await db.refresh(movement)

    # Back-in-stock notifications live here, in the API layer, rather than
    # in the apply_stock_movement trigger -- even though that trigger is
    # what actually owns "did this cross zero" for stock_quantity itself,
    # plain SQL can't call out to a push service. This endpoint already has
    # old_quantity/new_quantity in hand from the check above (the same
    # arithmetic the trigger does), so there's nothing to duplicate in
    # PL/pgSQL just to hand back out through some side channel.
    if old_quantity == 0 and new_quantity > 0:
        await notify_back_in_stock_subscribers(db, payload.variant_id, background_tasks)

    return movement


async def notify_back_in_stock_subscribers(
    db: AsyncSession, variant_id: uuid.UUID, background_tasks: BackgroundTasks
) -> None:
    pending = list(
        await db.scalars(
            select(StockNotificationRequest).where(
                StockNotificationRequest.variant_id == variant_id,
                StockNotificationRequest.notified_at.is_(None),
            )
        )
    )
    if not pending:
        return

    customer_ids = {request.customer_id for request in pending}
    tokens = list(
        await db.scalars(select(CustomerDeviceToken.token).where(CustomerDeviceToken.customer_id.in_(customer_ids)))
    )

    # Subscriptions are consumed by the restock event itself, regardless of
    # whether any of these customers currently has a push token registered
    # to actually deliver to -- resubscribing after the next sellout is how
    # they'd catch a restock they missed, not leaving this one open.
    now = datetime.now(UTC)
    for request in pending:
        request.notified_at = now
    await db.commit()

    if tokens:
        variant = await db.get(ProductVariant, variant_id)
        product = await db.get(Product, variant.product_id) if variant else None
        label = f"{product.name} ({variant.size})" if product and variant else "An item you wanted"
        background_tasks.add_task(send_push, tokens, "Back in stock", f"{label} is back in stock.")


@router.delete("/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stock_movement(
    movement_id: uuid.UUID,
    reason: str = Query(min_length=3, max_length=500),
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_owner),
) -> None:
    """Deletes one stock entry made by hand -- a delivery received, a count
    correction, a return -- and undoes its effect on stock. Owner only, for
    test entries and mistakes (see app/erase.py); everyone else corrects
    with an offsetting adjustment, which keeps the history. Refused for
    movements belonging to a sale or order, and for a stock-in whose units
    have since been sold (stock can't go below zero).
    """
    movement = await db.get(StockMovement, movement_id)
    if movement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stock entry not found")
    if movement.reference_type in _OWNED_BY:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This is part of a {_OWNED_BY[movement.reference_type]} — delete that instead",
        )
    variant = await db.get(ProductVariant, movement.variant_id)
    product = await db.get(Product, variant.product_id)
    change = f"{'+' if movement.quantity_change > 0 else ''}{movement.quantity_change}"

    await remove_movement(db, movement)
    record_deletion(
        db,
        staff,
        action="stock_movement.delete",
        table_name="stock_movements",
        record_id=movement.id,
        reason=reason.strip(),
        what={
            "summary": f"a stock entry for {product.name} ({variant.size}): {change}",
            "lines": f"{movement.movement_type.value}" + (f" — {movement.reason}" if movement.reason else ""),
            "made_at": movement.created_at.isoformat(),
        },
    )
    await db.commit()
