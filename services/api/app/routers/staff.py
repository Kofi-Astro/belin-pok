"""Admin-app user management. GET /me is open to any signed-in staff
member (so the app can show "who am I"); everything else -- listing staff,
inviting new ones, changing roles -- is owner-only."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import Staff, StaffRole
from app.schemas import StaffInvite, StaffRead, StaffUpdate
from app.supabase_admin import SupabaseAdminError, invite_user_by_email

router = APIRouter(prefix="/staff", tags=["staff"])

_owner_only = require_role(StaffRole.owner)


@router.get("/me", response_model=StaffRead)
async def get_my_staff_record(staff: Staff = Depends(get_current_staff)) -> Staff:
    return staff


@router.get("", response_model=list[StaffRead])
async def list_staff(db: AsyncSession = Depends(get_db), _staff: Staff = Depends(_owner_only)) -> list[Staff]:
    result = await db.scalars(select(Staff).order_by(Staff.full_name))
    return list(result)


@router.post("/invite", response_model=StaffRead, status_code=status.HTTP_201_CREATED)
async def invite_staff(
    payload: StaffInvite,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner_only),
) -> Staff:
    """Invites a new staff member by email via Supabase Auth, then creates
    their `staff` row. They'll set a password by following the invite
    email link (Supabase Auth handles that flow)."""
    try:
        invited_user = await invite_user_by_email(payload.email)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    new_staff = Staff(
        id=uuid.UUID(invited_user["id"]),
        email=payload.email,
        full_name=payload.full_name,
        role=payload.role,
    )
    db.add(new_staff)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Staff record already exists for this user"
        ) from exc
    await db.refresh(new_staff)
    return new_staff


@router.patch("/{staff_id}", response_model=StaffRead)
async def update_staff(
    staff_id: uuid.UUID,
    payload: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner_only),
) -> Staff:
    target = await db.get(Staff, staff_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(target, field, value)

    await db.commit()
    await db.refresh(target)
    return target
