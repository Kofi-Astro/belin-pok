"""Customer accounts, addresses, and the wholesale credit ledger.

Three access levels in one router: self-service endpoints (/me,
/me/addresses) any signed-in customer can call for their own account
(signing up itself is POST /auth/signup, in app/routers/auth.py);
staff-only reads/writes for managing customer records (approving
wholesale sign-ups, editing credit limits); and the credit ledger, which
is staff-only end to end since customers never see or post to it
directly."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_customer, get_current_staff, require_role
from app.erase import record_deletion
from app.models import (
    Address,
    CreditLedgerEntryType,
    Customer,
    CustomerCreditLedger,
    CustomerStatus,
    CustomerType,
    Order,
    PaymentMethod,
    POSSale,
    Staff,
    StaffRole,
    User,
)
from app.schemas import (
    AddressCreate,
    AddressRead,
    CustomerCreate,
    CustomerCreditAdjustmentCreate,
    CustomerCreditLedgerRead,
    CustomerCreditPaymentCreate,
    CustomerRead,
    CustomerStatusUpdate,
    CustomerUpdate,
)

router = APIRouter(prefix="/customers", tags=["customers"])

_write_roles = require_role(StaffRole.owner, StaffRole.order_fulfillment)
_owner = require_role(StaffRole.owner)

# ---------- storefront self-service (own account only) ----------
#
# Registered ahead of GET /{customer_id} below: FastAPI/Starlette route
# matching is order-sensitive, and "/{customer_id}" would otherwise
# swallow "/me" as a (then invalid) customer_id and 422
# instead of ever reaching these.


@router.get("/me", response_model=CustomerRead)
async def get_my_customer_profile(customer: Customer = Depends(get_current_customer)) -> Customer:
    return customer


@router.get("/me/addresses", response_model=list[AddressRead])
async def list_my_addresses(
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> list[Address]:
    stmt = (
        select(Address)
        .where(Address.customer_id == customer.id)
        .order_by(Address.is_default.desc(), Address.created_at.desc())
    )
    result = await db.scalars(stmt)
    return list(result)


@router.post("/me/addresses", response_model=AddressRead, status_code=status.HTTP_201_CREATED)
async def add_my_address(
    payload: AddressCreate,
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Address:
    address = Address(customer_id=customer.id, **payload.model_dump())
    db.add(address)
    await db.commit()
    await db.refresh(address)
    return address


# ---------- staff-only ----------


@router.get("", response_model=list[CustomerRead], dependencies=[Depends(get_current_staff)])
async def list_customers(
    response: Response,
    db: AsyncSession = Depends(get_db),
    status_filter: CustomerStatus | None = Query(default=None, alias="status"),
    customer_type: CustomerType | None = None,
    search: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Customer]:
    """Newest first. `search` matches name, business name, email or phone.
    X-Total-Count carries the number of matches across all pages."""
    stmt = select(Customer)
    if status_filter is not None:
        stmt = stmt.where(Customer.status == status_filter)
    if customer_type is not None:
        stmt = stmt.where(Customer.customer_type == customer_type)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                Customer.full_name.ilike(pattern),
                Customer.business_name.ilike(pattern),
                Customer.email.ilike(pattern),
                Customer.phone.ilike(pattern),
            )
        )
    response.headers["X-Total-Count"] = str(await db.scalar(select(func.count()).select_from(stmt.subquery())))
    result = await db.scalars(stmt.order_by(Customer.created_at.desc()).limit(limit).offset(offset))
    return list(result)


@router.get("/{customer_id}", response_model=CustomerRead, dependencies=[Depends(get_current_staff)])
async def get_customer(customer_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Customer:
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return customer


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
async def create_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_write_roles),
) -> Customer:
    # Wholesale accounts need approval; retail accounts created by staff
    # (e.g. a walk-in) don't.
    initial_status = (
        CustomerStatus.pending if payload.customer_type == CustomerType.wholesale else CustomerStatus.approved
    )
    customer = Customer(**payload.model_dump(), status=initial_status)
    db.add(customer)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A customer with this email already exists"
        ) from exc
    await db.refresh(customer)
    return customer


@router.patch("/{customer_id}", response_model=CustomerRead)
async def update_customer(
    customer_id: uuid.UUID,
    payload: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_write_roles),
) -> Customer:
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    await db.commit()
    await db.refresh(customer)
    return customer


@router.post("/{customer_id}/status", response_model=CustomerRead)
async def update_customer_status(
    customer_id: uuid.UUID,
    payload: CustomerStatusUpdate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> Customer:
    """Approve/reject a (typically wholesale) customer account."""
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    customer.status = payload.status
    if payload.status == CustomerStatus.approved:
        customer.approved_by = staff.id
        customer.approved_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(customer)
    return customer


# ---------- wholesale credit ledger ----------


@router.get(
    "/{customer_id}/credit-ledger",
    response_model=list[CustomerCreditLedgerRead],
    dependencies=[Depends(get_current_staff)],
)
async def list_credit_ledger(
    customer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[CustomerCreditLedgerRead]:
    """Full audit trail behind a customer's outstanding_balance -- every
    charge, payment, and manual adjustment that ever touched it."""
    stmt = (
        select(CustomerCreditLedger, Staff.full_name.label("performed_by_name"))
        .outerjoin(Staff, Staff.id == CustomerCreditLedger.performed_by)
        .where(CustomerCreditLedger.customer_id == customer_id)
        .order_by(CustomerCreditLedger.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        CustomerCreditLedgerRead.model_validate(row.CustomerCreditLedger).model_copy(
            update={"performed_by_name": row.performed_by_name}
        )
        for row in rows
    ]


@router.post(
    "/{customer_id}/credit-payments",
    response_model=CustomerCreditLedgerRead,
    status_code=status.HTTP_201_CREATED,
)
async def record_credit_payment(
    customer_id: uuid.UUID,
    payload: CustomerCreditPaymentCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> CustomerCreditLedger:
    """A wholesale customer paying down what they owe -- the only way
    outstanding_balance moves down other than voiding the original sale.
    Stored as a negative ledger entry so the same trigger that enforces
    the credit limit on charges (see migrations/) also applies
    the balance decrease atomically."""
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if payload.amount > float(customer.outstanding_balance):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payment (₵{payload.amount:.2f}) exceeds the ₵{customer.outstanding_balance:.2f} owed",
        )

    entry = CustomerCreditLedger(
        customer_id=customer_id,
        entry_type=CreditLedgerEntryType.payment,
        amount=-payload.amount,
        reason=payload.reason,
        method=PaymentMethod(payload.method),
        performed_by=staff.id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post(
    "/{customer_id}/credit-adjustments",
    response_model=CustomerCreditLedgerRead,
    status_code=status.HTTP_201_CREATED,
)
async def record_credit_adjustment(
    customer_id: uuid.UUID,
    payload: CustomerCreditAdjustmentCreate,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> CustomerCreditLedger:
    """A manual correction to a customer's balance (e.g. writing off a bad
    debt, fixing a data-entry mistake) -- owner/order_fulfillment only,
    same as every other write in this router, and always requires a
    reason since it's an override rather than a normal transaction."""
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    new_balance = float(customer.outstanding_balance) + payload.amount
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This adjustment would take the balance below ₵0 (currently ₵{customer.outstanding_balance:.2f})",
        )
    if new_balance > float(customer.credit_limit):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This adjustment would take the balance past the ₵{customer.credit_limit:.2f} credit limit",
        )

    entry = CustomerCreditLedger(
        customer_id=customer_id,
        entry_type=CreditLedgerEntryType.adjustment,
        amount=payload.amount,
        reason=payload.reason,
        performed_by=staff.id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: uuid.UUID,
    reason: str = Query(min_length=3, max_length=500),
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_owner),
) -> None:
    """Deletes a customer outright -- owner only, for test or duplicate
    records (see app/erase.py). Only once nothing refers to them: online
    orders, till sales and credit history all have to go first (delete
    test orders/sales, or keep a real customer). Their saved addresses,
    restock alerts and app devices go with them, and so does their website
    login, if they made one -- so the email can be used to sign up afresh.
    """
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    orders = await db.scalar(select(func.count()).where(Order.customer_id == customer_id))
    sales = await db.scalar(select(func.count()).where(POSSale.customer_id == customer_id))
    ledger = await db.scalar(select(func.count()).where(CustomerCreditLedger.customer_id == customer_id))
    if orders or sales or ledger:
        held = [
            f"{n} {label}{'s' if n != 1 else ''}"
            for n, label in ((orders, "online order"), (sales, "till sale"), (ledger, "credit entry"))
            if n
        ]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{customer.full_name} still has {', '.join(held)} — delete those first, or keep the customer",
        )

    record_deletion(
        db,
        staff,
        action="customer.delete",
        table_name="customers",
        record_id=customer.id,
        reason=reason.strip(),
        what={
            "summary": f"customer {customer.business_name or customer.full_name}",
            "lines": " · ".join(filter(None, [customer.phone, customer.email, customer.customer_type.value])),
        },
    )
    login_id = customer.auth_user_id
    await db.execute(delete(Customer).where(Customer.id == customer.id))
    # Their login too -- unless it somehow also belongs to a staff member.
    if login_id is not None and await db.get(Staff, login_id) is None:
        await db.execute(delete(User).where(User.id == login_id))
    await db.commit()
