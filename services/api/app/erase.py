"""Permanently deleting records -- the owner's way to clear out test data
or something entered that should never have existed (a sale rung up
while trying the till out, an order placed to test the website).

Everywhere else in this app nothing is ever deleted: stock_movements and
customer_credit_ledger are append-only ledgers, and mistakes are fixed
with offsetting entries (a void, a correction). That's right for real
trading, where the history must add up. For test data it's wrong: the
fake sale would sit in the reports forever, voided or not. So deletion
exists, but:

  - only owners can do it (each endpoint uses require_role(owner));
  - it needs a reason, and leaves an audit_log entry -- who deleted what,
    when, why, and a description of what it was -- which the activity
    log shows under "Deleted", so a deletion is never silent;
  - it undoes what the record did: stock comes back, credit charges come
    off the customer's balance. Both caches (product_variants.
    stock_quantity, customers.outstanding_balance) are only maintained by
    INSERT triggers, so these helpers adjust them directly, by exactly the
    net of the rows they remove.

The helpers here don't commit; the endpoint does, once everything for
the deletion has gone through, so it's all-or-nothing.
"""

import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Customer, CustomerCreditLedger, ProductVariant, Staff, StockMovement


async def undo_stock(db: AsyncSession, reference_types: list[str], reference_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Removes the stock movements a record caused and puts the stock back
    the way it was. Returns {variant_id: units returned} (negative would mean
    stock taken away -- e.g. deleting a stock-in -- which is refused if it
    would leave less than zero on hand, since those units are gone)."""
    movements = (
        await db.scalars(
            select(StockMovement).where(
                StockMovement.reference_type.in_(reference_types), StockMovement.reference_id == reference_id
            )
        )
    ).all()
    return await _remove_movements(db, movements)


async def _remove_movements(db: AsyncSession, movements) -> dict[uuid.UUID, int]:
    net: dict[uuid.UUID, int] = defaultdict(int)
    for m in movements:
        net[m.variant_id] += m.quantity_change
    # Lock in a fixed order, the same pattern checkout uses against races.
    for variant_id in sorted(net):
        variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
        if variant is not None and variant.stock_quantity - net[variant_id] < 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"SKU {variant.sku} only has {variant.stock_quantity} on hand, so its "
                    f"{net[variant_id]} received units can't be taken back out — they've since been sold"
                ),
            )
    for m in movements:
        await db.delete(m)
    for variant_id, change in net.items():
        if change:
            await db.execute(
                update(ProductVariant)
                .where(ProductVariant.id == variant_id)
                .values(stock_quantity=ProductVariant.stock_quantity - change)
            )
    return {variant_id: -change for variant_id, change in net.items() if change}


async def remove_movement(db: AsyncSession, movement: StockMovement) -> None:
    """Removes one stock movement and reverses its effect on stock."""
    await _remove_movements(db, [movement])


async def undo_credit(db: AsyncSession, reference_types: list[str], reference_id: uuid.UUID) -> float:
    """Removes the credit-ledger rows a record caused (a credit sale's
    charge, and its reversal if it was voided) and takes their net off the
    customer's balance. Returns the amount taken off.

    Refused if the customer's balance is already lower than that -- they've
    paid towards it since -- because the balance would go below zero; the
    payment needs dealing with first (a correction on their account)."""
    entries = (
        await db.scalars(
            select(CustomerCreditLedger).where(
                CustomerCreditLedger.reference_type.in_(reference_types),
                CustomerCreditLedger.reference_id == reference_id,
            )
        )
    ).all()
    net: dict[uuid.UUID, float] = defaultdict(float)
    for e in entries:
        net[e.customer_id] += float(e.amount)
    for customer_id, amount in net.items():
        customer = await db.scalar(select(Customer).where(Customer.id == customer_id).with_for_update())
        if customer is not None and float(customer.outstanding_balance) - amount < -0.005:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{customer.business_name or customer.full_name} has already paid towards this, so taking "
                    "its charge off would leave their balance below zero — correct their account first"
                ),
            )
    for e in entries:
        await db.delete(e)
    for customer_id, amount in net.items():
        if abs(amount) > 0.005:
            await db.execute(
                update(Customer)
                .where(Customer.id == customer_id)
                # Decimal, like the column: SQLAlchemy also applies this to
                # the customer already loaded above, in Python.
                .values(outstanding_balance=Customer.outstanding_balance - Decimal(str(round(amount, 2))))
            )
    return round(sum(net.values()), 2)


def record_deletion(
    db: AsyncSession,
    staff: Staff,
    *,
    action: str,
    table_name: str,
    record_id: uuid.UUID,
    reason: str,
    what: dict,
) -> None:
    """The audit trail for a deletion: `what` describes the record as it was
    (its summary line, amounts, who made it), since the record itself is
    gone. The activity log reads these back -- see reports.activity_log."""
    db.add(
        AuditLog(
            staff_id=staff.id,
            action=action,
            table_name=table_name,
            record_id=record_id,
            old_values=what,
            new_values={"reason": reason},
        )
    )


async def delete_where(db: AsyncSession, model, *conditions) -> None:
    """Plain bulk delete (for rows that hold no cached totals)."""
    await db.execute(delete(model).where(*conditions))
