"""Push-notification device token registration for signed-in storefront
customers -- see app/push.py for how these tokens actually get used (order
status updates, back-in-stock alerts)."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_customer
from app.models import Customer, CustomerDeviceToken
from app.schemas import DeviceTokenRegister

router = APIRouter(prefix="/customers/me/device-tokens", tags=["device-tokens"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def register_device_token(
    payload: DeviceTokenRegister,
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Register (or re-register) a push token for the signed-in customer's
    device. Upserts on the token itself -- a device reused across
    accounts (reinstall under a different sign-in, a shared phone) moves
    to whoever registers it most recently rather than erroring, since the
    old owner can no longer receive anything meaningful on it anyway."""
    stmt = (
        pg_insert(CustomerDeviceToken)
        .values(customer_id=customer.id, platform=payload.platform, token=payload.token)
        .on_conflict_do_update(
            index_elements=[CustomerDeviceToken.token],
            set_={"customer_id": customer.id, "platform": payload.platform},
        )
    )
    await db.execute(stmt)
    await db.commit()


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device_token(
    token: str,
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Sign-out (or notifications-off) should stop targeting this device --
    scoped to the caller's own customer_id so one customer can't unregister
    another's token by guessing it."""
    await db.execute(
        delete(CustomerDeviceToken).where(
            CustomerDeviceToken.token == token,
            CustomerDeviceToken.customer_id == customer.id,
        )
    )
    await db.commit()
