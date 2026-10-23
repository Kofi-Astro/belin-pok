"""Shop-wide settings (currently online pricing -- see app/pricing.py).
Any staff member can read them, since the admin uses them to preview
online prices; only an owner can change them, and every change is in the
audit log (and so the owner's activity log)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import AuditLog, ShopSettings, Staff, StaffRole
from app.pricing import get_shop_settings
from app.schemas import ShopSettingsRead, ShopSettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

_owner_only = require_role(StaffRole.owner)


def _snapshot(s: ShopSettings) -> dict:
    return {
        "online_markup_percent": float(s.online_markup_percent),
        "online_price_rounding": float(s.online_price_rounding),
    }


@router.get("", response_model=ShopSettingsRead, dependencies=[Depends(get_current_staff)])
async def read_settings(db: AsyncSession = Depends(get_db)) -> ShopSettings:
    return await get_shop_settings(db)


@router.patch("", response_model=ShopSettingsRead)
async def update_settings(
    payload: ShopSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    owner: Staff = Depends(_owner_only),
) -> ShopSettings:
    """Takes effect immediately for every online price -- the website, the
    phone app and checkout all price from these. Orders already placed keep
    the price they were placed at."""
    settings = await get_shop_settings(db)
    before = _snapshot(settings)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(settings, field, value)
    if changes:
        settings.updated_at = datetime.now(UTC)
        settings.updated_by = owner.id
        db.add(
            AuditLog(
                staff_id=owner.id,
                action="settings.update",
                table_name="shop_settings",
                record_id=None,
                old_values={k: before[k] for k in changes},
                new_values={k: float(v) for k, v in changes.items()},
            )
        )
    await db.commit()
    await db.refresh(settings)
    return settings
