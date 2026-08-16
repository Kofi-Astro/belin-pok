import uuid
from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Staff, StaffRole
from app.security import get_current_auth_user


async def get_current_staff(
    auth_user: dict[str, Any] = Depends(get_current_auth_user),
    db: AsyncSession = Depends(get_db),
) -> Staff:
    """Resolve the authenticated Supabase user to a `staff` row.

    Authentication (is this a valid Supabase user?) and authorization (is
    this user an active staff member, and what can their role do?) are
    deliberately separate steps: a valid Supabase account with no `staff`
    row -- e.g. a future storefront customer -- must not get admin access.
    """
    try:
        user_id = uuid.UUID(auth_user["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    staff = await db.scalar(select(Staff).where(Staff.id == user_id))
    if staff is None or not staff.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not an active staff member")
    return staff


def require_role(*allowed_roles: StaffRole) -> Callable:
    async def _check(staff: Staff = Depends(get_current_staff)) -> Staff:
        if staff.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{staff.role.value}' is not permitted to perform this action",
            )
        return staff

    return _check
