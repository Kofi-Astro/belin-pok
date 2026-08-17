import uuid
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import (
    CreditLedgerEntryType,
    Customer,
    CustomerCreditLedger,
    PaymentMethod,
    POSSale,
    POSSaleItem,
    POSSalePayment,
    PriceTier,
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


@dataclass
class _Line:
    """One merged (variant_id, price_tier) line from the request, resolved
    against the variant's actual prices. quantity is always in stock units
    (a 'pack' line's request quantity, in packs, gets multiplied out here),
    so it lines up 1:1 with what StockMovement/POSSaleItem expect."""

    variant_id: uuid.UUID
    price_tier: PriceTier
    quantity: int = 0
    unit_price: float = 0.0

    @property
    def line_total(self) -> float:
        return self.quantity * self.unit_price


@dataclass
class _ResolvedSale:
    lines: list[_Line] = field(default_factory=list)
    units_by_variant: dict[uuid.UUID, int] = field(default_factory=dict)


async def _hydrate(db: AsyncSession, sale: POSSale) -> POSSaleRead:
    staff = await db.get(Staff, sale.staff_id)
    customer = await db.get(Customer, sale.customer_id) if sale.customer_id else None

    stmt = (
        select(
            POSSaleItem,
            Product.name.label("product_name"),
            ProductVariant.size.label("variant_size"),
            ProductVariant.color.label("variant_color"),
            ProductVariant.pack_size.label("pack_size"),
        )
        .join(ProductVariant, ProductVariant.id == POSSaleItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(POSSaleItem.sale_id == sale.id)
    )
    rows = (await db.execute(stmt)).all()
    items = [
        POSSaleItemRead(
            variant_id=row.POSSaleItem.variant_id,
            product_name=row.product_name,
            variant_size=row.variant_size,
            variant_color=row.variant_color,
            price_tier=row.POSSaleItem.price_tier,
            quantity=row.POSSaleItem.quantity,
            unit_price=float(row.POSSaleItem.unit_price),
            line_total=float(row.POSSaleItem.line_total),
            pack_size=row.pack_size if row.POSSaleItem.price_tier == PriceTier.pack else None,
        )
        for row in rows
    ]

    credit_amount = sum(p.amount for p in sale.payments if p.method == PaymentMethod.credit)

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
        credit_amount=float(credit_amount),
    )


async def _resolve_lines(
    db: AsyncSession, payload_items: list, variants: dict[uuid.UUID, ProductVariant]
) -> _ResolvedSale:
    """Merges duplicate (variant_id, price_tier) request lines and prices
    each one server-side -- line prices are never trusted from the client,
    the same rule POST /stock-movements and checkout() already follow.
    """
    merged: dict[tuple[uuid.UUID, PriceTier], int] = {}
    for item in payload_items:
        key = (item.variant_id, item.price_tier)
        merged[key] = merged.get(key, 0) + item.quantity

    products = {v.product_id: await db.get(Product, v.product_id) for v in variants.values()}

    resolved = _ResolvedSale()
    for (variant_id, tier), request_quantity in merged.items():
        variant = variants[variant_id]
        product = products[variant.product_id]
        retail_price = variant.price_override if variant.price_override is not None else float(product.base_price)

        if tier == PriceTier.retail:
            unit_price = retail_price
            stock_units = request_quantity
        elif tier == PriceTier.wholesale:
            unit_price = float(variant.wholesale_price) if variant.wholesale_price is not None else retail_price
            stock_units = request_quantity
        else:  # pack
            if variant.pack_price is None or variant.pack_size is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"SKU {variant.sku} has no pack pricing configured",
                )
            unit_price = float(variant.pack_price) / variant.pack_size
            stock_units = request_quantity * variant.pack_size

        resolved.lines.append(
            _Line(variant_id=variant_id, price_tier=tier, quantity=stock_units, unit_price=unit_price)
        )
        resolved.units_by_variant[variant_id] = resolved.units_by_variant.get(variant_id, 0) + stock_units

    return resolved


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
    """Records a whole register transaction: one or more items (each
    priced at retail, wholesale, or a factory pack rate), one or more
    payment lines covering the total between them -- 'credit' is a payment
    method like any other, so a sale can split across e.g. part cash, part
    on-account. Line prices are always looked up server-side (never
    trusted from the client) and the payment total must match exactly, the
    same way a real till balances before it'll open the drawer.

    A credit portion requires payload.customer_id -- checked here for a
    friendly 400, and enforced regardless by a DB trigger (see
    supabase/migrations) that also blocks the whole transaction if it
    would push the customer's balance past their credit limit, so this
    guarantee holds even if this check is ever bypassed or wrong.
    """
    wants_credit = any(p.method == PaymentMethod.credit for p in payload.payments)
    if wants_credit:
        if payload.customer_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A credit payment requires selecting a customer",
            )
        customer = await db.get(Customer, payload.customer_id)
        if customer is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
        if not customer.is_wholesale_verified:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{customer.full_name} is not an approved wholesale account and cannot buy on credit",
            )
        credit_amount = sum(p.amount for p in payload.payments if p.method == PaymentMethod.credit)
        prospective_balance = float(customer.outstanding_balance) + credit_amount
        if prospective_balance > float(customer.credit_limit):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"This would take {customer.full_name}'s balance to ₵{prospective_balance:.2f}, "
                    f"past their ₵{customer.credit_limit:.2f} credit limit"
                ),
            )

    # Lock every distinct variant row up front in a fixed order -- same
    # race-safety pattern as storefront checkout(): two sales racing for
    # the last unit of something can't both succeed.
    variant_ids = sorted({item.variant_id for item in payload.items})
    variants: dict[uuid.UUID, ProductVariant] = {}
    for variant_id in variant_ids:
        variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
        if variant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Variant {variant_id} not found")
        variants[variant_id] = variant

    resolved = await _resolve_lines(db, payload.items, variants)

    for variant_id, needed in resolved.units_by_variant.items():
        variant = variants[variant_id]
        if variant.stock_quantity < needed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {variant.stock_quantity} left in stock for SKU {variant.sku}",
            )

    computed_total = sum(line.line_total for line in resolved.lines)
    paid_total = sum(p.amount for p in payload.payments)
    if abs(paid_total - computed_total) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payments (₵{paid_total:.2f}) don't match the total (₵{computed_total:.2f})",
        )

    sale = POSSale(customer_id=payload.customer_id, staff_id=staff.id)
    db.add(sale)
    await db.flush()

    for variant_id, total_units in resolved.units_by_variant.items():
        db.add(
            StockMovement(
                variant_id=variant_id,
                movement_type=StockMovementType.sale,
                quantity_change=-total_units,
                reference_type="pos_sale",
                reference_id=sale.id,
                performed_by=staff.id,
            )
        )
    for line in resolved.lines:
        db.add(
            POSSaleItem(
                sale_id=sale.id,
                variant_id=line.variant_id,
                price_tier=line.price_tier,
                quantity=line.quantity,
                unit_price=line.unit_price,
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
    movement) and any credit charge it created, then marks the sale
    voided. For fixing a mistaken entry, not a customer return -- nothing
    is deleted, matching every other ledger in this app.
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

    for payment in sale.payments:
        if payment.method == PaymentMethod.credit:
            db.add(
                CustomerCreditLedger(
                    customer_id=sale.customer_id,
                    entry_type=CreditLedgerEntryType.adjustment,
                    amount=-payment.amount,
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
