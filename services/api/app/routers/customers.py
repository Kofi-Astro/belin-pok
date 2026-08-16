import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Customer, CustomerStatus, CustomerType, Staff, StaffRole
from app.schemas import CustomerCreate, CustomerRead, CustomerStatusUpdate, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"])

_write_roles = require_role(StaffRole.owner, StaffRole.order_fulfillment)


@router.get("", response_model=list[CustomerRead], dependencies=[Depends(get_current_staff)])
async def list_customers(
    db: AsyncSession = Depends(get_db),
    status_filter: CustomerStatus | None = Query(default=None, alias="status"),
    customer_type: CustomerType | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Customer]:
    stmt = select(Customer).order_by(Customer.created_at.desc()).limit(limit).offset(offset)
    if status_filter is not None:
        stmt = stmt.where(Customer.status == status_filter)
    if customer_type is not None:
        stmt = stmt.where(Customer.customer_type == customer_type)
    result = await db.scalars(stmt)
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
