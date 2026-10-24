"""End-of-day cash-up: at closing, staff count the drawer (and check the
mobile money and card totals), and the app compares the count with what
the till recorded, showing any shortage or surplus.

What should be in the cash drawer:

    opening float (the change it started the day with)
  + cash sales
  + cash repayments from wholesale customers
  - cash refunds for returned goods
  - cash paid out of the drawer for shop costs

Mobile money and card are the day's sales and repayments on them, minus
refunds. Credit (sold on account) isn't money taken, so it's shown but
never counted.

Staff count "blind": until the day has been counted, only an owner sees
what the till expects (GET /cash-ups/day leaves the figures out for
anyone else), so the count is an honest count rather than one nudged
towards the expected figure. Once it's saved, everyone sees the result.

One cash-up per day. Counting again replaces it -- miscounts happen --
but every save goes into the audit log with the figures, so the owner's
activity log shows the first count as well as the redo.
"""

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_role
from app.models import (
    AuditLog,
    CashUp,
    CreditLedgerEntryType,
    CustomerCreditLedger,
    PaymentMethod,
    POSSale,
    POSSaleItem,
    POSSalePayment,
    POSSaleReturn,
    Staff,
    StaffRole,
)
from app.schemas import CashUpCreate, CashUpDay, CashUpFigures, CashUpRead
from app.shop_time import day_range
from app.shop_time import today as shop_today

router = APIRouter(prefix="/cash-ups", tags=["cash-ups"])

# Whoever works the till can close it; the history is the owner's.
_till_roles = require_role(StaffRole.owner, StaffRole.inventory_manager, StaffRole.order_fulfillment)
_owner = require_role(StaffRole.owner)

_COUNTED = ("cash", "mobile_money", "card")


def _money_dict(methods=_COUNTED) -> dict[str, float]:
    return dict.fromkeys(methods, 0.0)


async def _figures(db: AsyncSession, day: date) -> CashUpFigures:
    """What the till recorded on `day` (the shop's calendar day)."""
    start, end = day_range(day, day)
    completed = (POSSale.status == "completed", POSSale.created_at >= start, POSSale.created_at < end)

    receipts, takings, discounts = (
        await db.execute(
            select(
                func.count(func.distinct(POSSale.id)),
                func.coalesce(func.sum(POSSaleItem.line_total), 0),
                func.coalesce(func.sum(POSSaleItem.discount), 0),
            )
            .join(POSSaleItem, POSSaleItem.sale_id == POSSale.id)
            .where(*completed)
        )
    ).one()
    # Sales voided on this day, whenever they were rung up -- the till's
    # "what happened today" view, shown alongside the count.
    voided = await db.scalar(
        select(func.count()).where(POSSale.status == "voided", POSSale.voided_at >= start, POSSale.voided_at < end)
    )

    sales = _money_dict((*_COUNTED, "credit"))
    for method, amount in await db.execute(
        select(POSSalePayment.method, func.sum(POSSalePayment.amount))
        .join(POSSale, POSSale.id == POSSalePayment.sale_id)
        .where(*completed)
        .group_by(POSSalePayment.method)
    ):
        sales[method.value] = float(amount)

    # Repayments are stored as negative amounts (they reduce the balance).
    # Ones recorded before the method was asked for count as cash, by far
    # the likeliest.
    repayments = _money_dict()
    for method, amount in await db.execute(
        select(CustomerCreditLedger.method, func.sum(CustomerCreditLedger.amount))
        .where(
            CustomerCreditLedger.entry_type == CreditLedgerEntryType.payment,
            CustomerCreditLedger.created_at >= start,
            CustomerCreditLedger.created_at < end,
        )
        .group_by(CustomerCreditLedger.method)
    ):
        key = (method or PaymentMethod.cash).value
        if key in repayments:
            repayments[key] += abs(float(amount))

    refunds = await _refunds(db, start, end)

    return CashUpFigures(
        receipts=receipts,
        takings=float(takings),
        discounts=float(discounts),
        voided_count=voided or 0,
        sales_by_method=sales,
        repayments_by_method=repayments,
        refunds_by_method=refunds,
        money_in={m: round(sales[m] + repayments[m] - refunds[m], 2) for m in _COUNTED},
    )


async def _refunds(db: AsyncSession, start: datetime, end: datetime) -> dict[str, float]:
    """Money handed back for returns in [start, end), by method (refunds
    to a customer's account aren't money out, so they're left out)."""
    refunds = _money_dict()
    for method, amount in await db.execute(
        select(POSSaleReturn.refund_method, func.sum(POSSaleReturn.refund_amount))
        .where(
            POSSaleReturn.created_at >= start,
            POSSaleReturn.created_at < end,
            POSSaleReturn.refund_method.is_not(None),
        )
        .group_by(POSSaleReturn.refund_method)
    ):
        if method.value in refunds:
            refunds[method.value] = float(amount)
    return refunds


def _read(cash_up: CashUp, counted_by_name: str | None) -> CashUpRead:
    """The saved cash-up with its differences (counted - expected)."""
    read = CashUpRead.model_validate(cash_up)
    read.counted_by_name = counted_by_name
    read.cash_difference = round(read.counted_cash - read.expected_cash, 2)
    if read.counted_mobile_money is not None:
        read.mobile_money_difference = round(read.counted_mobile_money - read.expected_mobile_money, 2)
    if read.counted_card is not None:
        read.card_difference = round(read.counted_card - read.expected_card, 2)
    read.total_difference = round(
        read.cash_difference + (read.mobile_money_difference or 0) + (read.card_difference or 0), 2
    )
    return read


async def _staff_name(db: AsyncSession, staff_id: uuid.UUID) -> str | None:
    staff = await db.get(Staff, staff_id)
    return staff.full_name if staff else None


async def _suggested_float(db: AsyncSession, day: date) -> float:
    """What the last cash-up before `day` left in the drawer -- the float
    the next day starts with."""
    left = await db.scalar(
        select(CashUp.left_in_drawer)
        .where(CashUp.business_date < day, CashUp.left_in_drawer.is_not(None))
        .order_by(CashUp.business_date.desc())
        .limit(1)
    )
    return float(left or 0)


def _check_day(day: date) -> None:
    if day > shop_today():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That day hasn't happened yet")


@router.get("/day", response_model=CashUpDay)
async def cash_up_day(
    day: date | None = None,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_till_roles),
) -> CashUpDay:
    """The cash-up screen for one day (default: today): the saved count,
    if any, with its differences; what the till recorded (owners always,
    everyone else only once the day is counted -- see the module
    docstring); and the float to start from."""
    day = day or shop_today()
    _check_day(day)
    figures = await _figures(db, day)
    cash_up = await db.scalar(select(CashUp).where(CashUp.business_date == day))
    read = _read(cash_up, await _staff_name(db, cash_up.counted_by)) if cash_up else None
    changed = False
    if cash_up:
        # Expected cash minus the float and paid-out is what the sales part
        # was when it was counted; compare that with the till now.
        counted_cash_in = float(cash_up.expected_cash) - float(cash_up.opening_float) + float(cash_up.paid_out)
        changed = any(
            abs(a - b) > 0.009
            for a, b in (
                (counted_cash_in, figures.money_in["cash"]),
                (float(cash_up.expected_mobile_money), figures.money_in["mobile_money"]),
                (float(cash_up.expected_card), figures.money_in["card"]),
            )
        )
    can_see = StaffRole.owner in staff.role_set or cash_up is not None
    return CashUpDay(
        business_date=day,
        figures=figures if can_see else None,
        suggested_opening_float=float(cash_up.opening_float) if cash_up else await _suggested_float(db, day),
        cash_up=read,
        changed_since=changed,
    )


@router.post("", response_model=CashUpRead)
async def save_cash_up(
    payload: CashUpCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_till_roles),
) -> CashUpRead:
    """Saves the count for a day (default: today), working out what was
    expected from the till at this moment. Counting a day again replaces
    the earlier count; both go into the audit log."""
    day = payload.business_date or shop_today()
    _check_day(day)
    figures = await _figures(db, day)
    expected = {
        "expected_cash": round(payload.opening_float + figures.money_in["cash"] - payload.paid_out, 2),
        "expected_mobile_money": figures.money_in["mobile_money"],
        "expected_card": figures.money_in["card"],
    }
    values = {
        "opening_float": payload.opening_float,
        "paid_out": payload.paid_out,
        "paid_out_note": (payload.paid_out_note or "").strip() or None,
        "counted_cash": payload.counted_cash,
        "counted_mobile_money": payload.counted_mobile_money,
        "counted_card": payload.counted_card,
        "left_in_drawer": payload.left_in_drawer,
        "note": (payload.note or "").strip() or None,
        **expected,
    }

    # Lock the day's row (if any) so two people saving at once can't both
    # insert -- the unique business_date would refuse the second anyway.
    cash_up = await db.scalar(select(CashUp).where(CashUp.business_date == day).with_for_update())
    previous = None
    if cash_up is None:
        cash_up = CashUp(business_date=day, counted_by=staff.id, **values)
        db.add(cash_up)
    else:
        previous = _read(cash_up, await _staff_name(db, cash_up.counted_by))
        for key, value in values.items():
            setattr(cash_up, key, value)
        cash_up.counted_by = staff.id
        cash_up.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(cash_up)
    result = _read(cash_up, staff.full_name)

    # The activity log's record of the count (app/routers/reports.py).
    db.add(
        AuditLog(
            staff_id=staff.id,
            action="cash_up.redo" if previous else "cash_up.save",
            table_name="cash_ups",
            record_id=cash_up.id,
            old_values=_audit_values(previous) if previous else None,
            new_values=_audit_values(result),
        )
    )
    await db.commit()
    return result


def _audit_values(read: CashUpRead) -> dict:
    return {
        "business_date": read.business_date.isoformat(),
        "counted_cash": read.counted_cash,
        "expected_cash": read.expected_cash,
        "cash_difference": read.cash_difference,
        "mobile_money_difference": read.mobile_money_difference,
        "card_difference": read.card_difference,
        "total_difference": read.total_difference,
        "paid_out": read.paid_out,
        "paid_out_note": read.paid_out_note,
        "note": read.note,
    }


@router.get("", response_model=list[CashUpRead])
async def list_cash_ups(
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner),
) -> list[CashUpRead]:
    """Past cash-ups, newest first (owner only) -- the record of every
    day's shortages and surpluses."""
    stmt = select(CashUp, Staff.full_name).outerjoin(Staff, Staff.id == CashUp.counted_by)
    if date_from:
        stmt = stmt.where(CashUp.business_date >= date_from)
    if date_to:
        stmt = stmt.where(CashUp.business_date <= date_to)
    rows = await db.execute(stmt.order_by(CashUp.business_date.desc()).limit(400))
    return [_read(cash_up, name) for cash_up, name in rows]
