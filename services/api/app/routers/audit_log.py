import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_role
from app.models import AuditLog, Staff, StaffRole
from app.schemas import AuditLogRead

router = APIRouter(prefix="/audit-log", tags=["audit-log"])

_read_roles = require_role(StaffRole.owner)


@router.get("", response_model=list[AuditLogRead])
async def list_audit_log(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_read_roles),
    table_name: str | None = None,
    record_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AuditLogRead]:
    stmt = (
        select(AuditLog, Staff.full_name.label("staff_name"))
        .outerjoin(Staff, Staff.id == AuditLog.staff_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    if table_name is not None:
        stmt = stmt.where(AuditLog.table_name == table_name)
    if record_id is not None:
        stmt = stmt.where(AuditLog.record_id == record_id)

    rows = (await db.execute(stmt)).all()
    return [
        AuditLogRead.model_validate(row.AuditLog).model_copy(
            update={"staff_name": row.staff_name}
        )
        for row in rows
    ]
