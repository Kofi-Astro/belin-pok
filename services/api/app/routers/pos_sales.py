import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import (
    Customer,
    POSSale,
    POSSalePayment,
    Product,
    ProductVariant,
    Staff,
    StaffRole,
    StockMovement,
    StockMovementType,
)
from app.schemas import POSSaleCreate, POSSaleItemRead, POSSalePaymentRead, POSSaleRead

router = APIRouter(prefix="/pos-sales", tags=["pos-sales"])

_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager, StaffRole.order_fulfillment)


async def _hydrate(db: AsyncSession, sale: POSSale) -> POSSaleRead:
    staff = await db.get(Staff, sale.staff_id)
    customer = await db.get(Customer, sale.customer_id) if sale.customer_id else None

    unit_price = func.coalesce(ProductVariant.price_override, Product.base_price)
    stmt = (
        select(
            StockMovement.variant_id,
            Product.name.label("product_name"),
            ProductVariant.size.label("variant_size"),
            ProductVariant.color.label("variant_color"),
            (-StockMovement.quantity_change).label("quantity"),
            unit_price.label("unit_price"),
        )
        .join(ProductVariant, ProductVariant.id == StockMovement.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(StockMovement.reference_type == "pos_sale", StockMovement.reference_id == sale.id)
    )
    rows = (await db.execute(stmt)).all()
    items = [
        POSSaleItemRead(
            variant_id=row.variant_id,
            product_name=row.product_name,
            variant_size=row.variant_size,
            variant_color=row.variant_color,
            quantity=row.quantity,
            unit_price=float(row.unit_price),
            line_total=float(row.unit_price) * row.quantity,
        )
        for row in rows
    ]

    return POSSaleRead(
        id=sale.id,
        customer_id=sale.customer_id,
        staff_id=sale.staff_id,
        status=sale.status,
        created_at=sale.created_at,
        staff_name=staff.full_name if staff else None,
        customer_name=customer.full_name if customer else None,
        items=items,
        payments=[POSSalePaymentRead.model_validate(p) for p in sale.payments],
        total=sum(item.line_total for item in items),
    )


@router.get("", response_model=list[POSSaleRead], dependencies=[Depends(get_current_staff)])
async def list_pos_sales(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[POSSaleRead]:
    stmt = (
        select(POSSale)
        .options(selectinload(POSSale.payments))
        .order_by(POSSale.created_at.desc())
        .limit(limit)
    )
    sales = (await db.scalars(stmt)).all()
    return [await _hydrate(db, sale) for sale in sales]


@router.post("", response_model=POSSaleRead, status_code=status.HTTP_201_CREATED)
async def create_pos_sale(
    payload: POSSaleCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> POSSaleRead:
    """Records a whole register transaction: one or more items, one or
    more payment lines covering the total between them. Line prices are
    always looked up server-side (never trusted from the client) and the
    payment total must match exactly, the same way a real till balances
    before it'll open the drawer.
    """
    # Merge duplicate lines for the same variant, then lock every distinct
    # variant row up front in a fixed order -- same race-safety pattern as
    # storefront checkout(): two sales racing for the last unit of
    # something can't both succeed.
    quantities: dict[uuid.UUID, int] = {}
    for item in payload.items:
        quantities[item.variant_id] = quantities.get(item.variant_id, 0) + item.quantity

    variants: dict[uuid.UUID, ProductVariant] = {}
    for variant_id in sorted(quantities):
        variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
        if variant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Variant {variant_id} not found")
        if variant.stock_quantity < quantities[variant_id]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {variant.stock_quantity} left in stock for SKU {variant.sku}",
            )
        variants[variant_id] = variant

    products = {v.product_id: await db.get(Product, v.product_id) for v in variants.values()}
    computed_total = 0.0
    for variant_id, quantity in quantities.items():
        variant = variants[variant_id]
        product = products[variant.product_id]
        unit_price = variant.price_override if variant.price_override is not None else product.base_price
        computed_total += float(unit_price) * quantity

    paid_total = sum(p.amount for p in payload.payments)
    if abs(paid_total - computed_total) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payments (₵{paid_total:.2f}) don't match the total (₵{computed_total:.2f})",
        )

    sale = POSSale(customer_id=payload.customer_id, staff_id=staff.id)
    db.add(sale)
    await db.flush()

    for variant_id, quantity in quantities.items():
        db.add(
            StockMovement(
                variant_id=variant_id,
                movement_type=StockMovementType.sale,
                quantity_change=-quantity,
                reference_type="pos_sale",
                reference_id=sale.id,
                performed_by=staff.id,
            )
        )
    for p in payload.payments:
        db.add(POSSalePayment(sale_id=sale.id, method=p.method, amount=p.amount))

    await db.commit()

    stmt = select(POSSale).where(POSSale.id == sale.id).options(selectinload(POSSale.payments))
    sale = await db.scalar(stmt)
    return await _hydrate(db, sale)


@router.post("/{sale_id}/void", response_model=POSSaleRead)
async def void_pos_sale(
    sale_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> POSSaleRead:
    """Reverses every item in the sale (stock comes back, and it nets out
    of daily-sales totals since the reversal is itself a 'sale'-type
    movement) and marks the sale voided. For fixing a mistaken entry, not
    a customer return -- nothing is deleted, matching every other ledger
    in this app.
    """
    stmt = select(POSSale).where(POSSale.id == sale_id).options(selectinload(POSSale.payments))
    sale = await db.scalar(stmt)
    if sale is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sale not found")
    if sale.status == "voided":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This sale has already been voided")

    original_items = (
        await db.scalars(
            select(StockMovement).where(
                StockMovement.reference_type == "pos_sale", StockMovement.reference_id == sale.id
            )
        )
    ).all()
    for movement in original_items:
        db.add(
            StockMovement(
                variant_id=movement.variant_id,
                movement_type=StockMovementType.sale,
                quantity_change=-movement.quantity_change,
                reason="Correction: voided POS sale",
                reference_type="pos_sale_void",
                reference_id=sale.id,
                performed_by=staff.id,
            )
        )
    sale.status = "voided"
    await db.commit()

    stmt = select(POSSale).where(POSSale.id == sale.id).options(selectinload(POSSale.payments))
    sale = await db.scalar(stmt)
    return await _hydrate(db, sale)
