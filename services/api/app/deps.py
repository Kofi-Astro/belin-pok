import uuid
from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Customer, Staff, StaffRole
from app.security import get_current_auth_user, get_optional_auth_user


async def get_current_staff(
    auth_user: dict[str, Any] = Depends(get_current_auth_user),
    db: AsyncSession = Depends(get_db),
) -> Staff:
    """Resolve the authenticated Supabase user to a `staff` row.

    Authentication (is this a valid Supabase user?) and authorization (is
    this user an active staff member, and what can their role do?) are
    deliberately separate steps: a valid Supabase account with no `staff`
    row -- e.g. a storefront customer -- must not get admin access.
    """
    try:
        user_id = uuid.UUID(auth_user["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    staff = await db.scalar(select(Staff).where(Staff.id == user_id))
    if staff is None or not staff.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not an active staff member")
    return staff


async def get_current_customer(
    auth_user: dict[str, Any] = Depends(get_current_auth_user),
    db: AsyncSession = Depends(get_db),
) -> Customer:
    """Resolve the authenticated Supabase user to a `customers` row (the
    storefront equivalent of get_current_staff). Requires the customer to
    have already self-registered via POST /customers/register -- a valid
    Supabase account alone doesn't imply a customer profile exists yet."""
    try:
        user_id = uuid.UUID(auth_user["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    customer = await db.scalar(select(Customer).where(Customer.auth_user_id == user_id))
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No customer account for this user yet -- register first",
        )
    return customer


async def get_optional_customer(
    auth_user: dict[str, Any] | None = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
) -> Customer | None:
    """Same as get_current_customer, but returns None for a request with
    no bearer token at all (a guest), instead of 401ing. A bearer token
    that doesn't resolve to a customer still raises -- that's a signed-in
    user who hasn't registered, not a guest, and silently treating them as
    one would create a second, disconnected customer record for the same
    person."""
    if auth_user is None:
        return None
    try:
        user_id = uuid.UUID(auth_user["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    customer = await db.scalar(select(Customer).where(Customer.auth_user_id == user_id))
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No customer account for this user yet -- register first",
        )
    return customer


def require_role(*allowed_roles: StaffRole) -> Callable:
    async def _check(staff: Staff = Depends(get_current_staff)) -> Staff:
        if staff.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{staff.role.value}' is not permitted to perform this action",
            )
        return staff

    return _check
