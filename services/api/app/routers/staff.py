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
from app.email import send_email
from app.models import OneTimeTokenPurpose, Staff, StaffRole, User
from app.routers.auth import create_one_time_link, revoke_all_sessions
from app.schemas import StaffInvite, StaffInviteRead, StaffRead, StaffUpdate

router = APIRouter(prefix="/staff", tags=["staff"])

_owner_only = require_role(StaffRole.owner)


@router.get("/me", response_model=StaffRead)
async def get_my_staff_record(staff: Staff = Depends(get_current_staff)) -> Staff:
    return staff


@router.get("", response_model=list[StaffRead])
async def list_staff(db: AsyncSession = Depends(get_db), _staff: Staff = Depends(_owner_only)) -> list[Staff]:
    result = await db.scalars(select(Staff).order_by(Staff.full_name))
    return list(result)


async def _send_invite_email(staff: Staff, link: str) -> None:
    await send_email(
        staff.email,
        "You've been invited to Belin-Pok",
        f"Hi {staff.full_name},\n\n"
        "You've been added to the Belin-Pok admin app. Set your password here to get started "
        f"(the link works once, for the next 7 days):\n{link}\n",
    )


@router.post("/invite", response_model=StaffInviteRead, status_code=status.HTTP_201_CREATED)
async def invite_staff(
    payload: StaffInvite,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner_only),
) -> StaffInviteRead:
    """Creates a staff member's login (with no password yet) and their
    `staff` row together, then emails them a link to set a password.

    The same link is also returned to the owner in the response: email is
    optional (see app/email.py), and even when it's set up, sending a
    link over WhatsApp is often quicker than waiting on an inbox. Until
    the link is used, the account simply can't sign in.
    """
    email = payload.email.strip()
    user = User(email=email)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Someone with this email already has an account",
        ) from exc

    new_staff = Staff(id=user.id, email=email, full_name=payload.full_name, role=payload.role)
    db.add(new_staff)
    link = await create_one_time_link(db, user, OneTimeTokenPurpose.invite)
    await db.commit()
    await db.refresh(new_staff)

    await _send_invite_email(new_staff, link)
    return StaffInviteRead(**StaffRead.model_validate(new_staff).model_dump(), invite_link=link)


@router.post("/{staff_id}/invite-link", response_model=StaffInviteRead)
async def reissue_invite_link(
    staff_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner_only),
) -> StaffInviteRead:
    """A fresh set-password link for someone whose invite expired or got
    lost. Doubles as an owner-assisted password reset for a staff member
    who's locked out -- redeeming it replaces whatever password they had.
    Older unused links for them keep working until they expire or this
    one is used (redeeming any link burns all of them; see
    app/routers/auth.py's set_password_with_token)."""
    target = await db.get(Staff, staff_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")
    user = await db.get(User, staff_id)

    link = await create_one_time_link(db, user, OneTimeTokenPurpose.invite)
    await db.commit()
    if target.email:
        await _send_invite_email(target, link)
    return StaffInviteRead(**StaffRead.model_validate(target).model_dump(), invite_link=link)


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

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(target, field, value)

    # Deactivating someone signs them out of every device right away,
    # rather than leaving their refresh tokens able to start new sessions
    # (which _ensure_may_sign_in would refuse anyway -- this just means
    # nothing is left lying around if they're ever reactivated).
    if changes.get("is_active") is False:
        await revoke_all_sessions(db, staff_id)

    await db.commit()
    await db.refresh(target)
    return target
