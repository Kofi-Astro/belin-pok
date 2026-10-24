"""The website's editable content -- what the admin's Website page changes:
announcement strip, home page banner, selling points, featured products,
which home sections show, the wholesale section, footer text, contact
details and social links. The shape and defaults are StorefrontContent in
app/schemas.py; it's stored as one JSON document (see
migrations/20261024120001_storefront_content.sql).

  GET /public/storefront  what the website renders (no sign-in)
  GET /storefront         the same for the admin, with who changed it last
  PUT /storefront         replace it (owner or inventory manager)

The website caches what it reads for a minute (apps/web/src/lib/content.ts),
so a change shows there within that.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_staff, require_role
from app.models import AuditLog, Product, ProductStatus, ProductVariant, Staff, StaffRole
from app.models import StorefrontContent as StorefrontContentRow
from app.pricing import get_shop_settings, public_view
from app.schemas import PublicStorefront, StorefrontContent, StorefrontContentRead

router = APIRouter(tags=["storefront"])

# Same as the catalogue: the people who manage products manage how they're
# presented.
_write_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)


async def _row(db: AsyncSession) -> StorefrontContentRow:
    # The migration inserts the single row.
    return await db.get(StorefrontContentRow, 1)


def _content(row: StorefrontContentRow) -> StorefrontContent:
    """The stored document, with defaults filled in for anything not set."""
    return StorefrontContent.model_validate(row.content or {})


@router.get("/public/storefront", response_model=PublicStorefront)
async def public_storefront(db: AsyncSession = Depends(get_db)) -> PublicStorefront:
    """The content for the website, including the featured products
    themselves: only live ones, priced as shoppers see them (online
    prices, no trade prices -- see app/pricing.public_view), in the order
    they were picked."""
    content = _content(await _row(db))
    featured = []
    if content.featured.enabled and content.featured.product_ids:
        products = (
            await db.scalars(
                select(Product)
                .where(Product.id.in_(content.featured.product_ids), Product.status == ProductStatus.active)
                .options(
                    selectinload(Product.variants.and_(ProductVariant.is_active.is_(True))),
                    selectinload(Product.images),
                )
            )
        ).all()
        by_id = {p.id: p for p in products}
        settings = await get_shop_settings(db)
        featured = [public_view(by_id[i], settings) for i in content.featured.product_ids if i in by_id]
    return PublicStorefront(**content.model_dump(), featured_products=featured)


@router.get("/storefront", response_model=StorefrontContentRead, dependencies=[Depends(get_current_staff)])
async def read_storefront(db: AsyncSession = Depends(get_db)) -> StorefrontContentRead:
    row = await _row(db)
    editor = await db.get(Staff, row.updated_by) if row.updated_by else None
    return StorefrontContentRead(
        content=_content(row), updated_at=row.updated_at, updated_by_name=editor.full_name if editor else None
    )


@router.put("/storefront", response_model=StorefrontContentRead)
async def update_storefront(
    payload: StorefrontContent,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> StorefrontContentRead:
    """Replaces the content (the admin always sends the whole document).
    Records which sections changed in the audit log, so the owner's
    activity log shows "Changed the website (banner, footer)"."""
    row = await _row(db)
    before = _content(row).model_dump(mode="json")
    after = payload.model_dump(mode="json")
    changed = [key for key in after if before.get(key) != after.get(key)]
    if changed:
        row.content = after
        row.updated_at = datetime.now(UTC)
        row.updated_by = staff.id
        db.add(
            AuditLog(
                staff_id=staff.id,
                action="storefront.update",
                table_name="storefront_content",
                record_id=None,
                old_values=None,
                new_values={"changed": changed},
            )
        )
        await db.commit()
    return await read_storefront(db)
