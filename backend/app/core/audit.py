"""Audit logging utilities."""

from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inv_audit import InvAuditLog
from app.core.db import SessionLocal


async def log_audit(
    session: AsyncSession,
    user_code: str,
    entity: str,
    entity_id: Optional[str],
    action: str,
    details: Optional[dict[str, Any]] = None,
    remote_addr: Optional[str] = None,
    *,
    independent_txn: bool = False,
) -> None:
    payload = {
        "user_code": user_code,
        "entity": entity,
        "entity_id": entity_id,
        "action": action,
        "details": json.dumps(details) if details is not None else None,
        "remote_addr": remote_addr,
    }
    if independent_txn:
        async with SessionLocal() as audit_session:
            async with audit_session.begin():
                await audit_session.execute(insert(InvAuditLog).values(**payload))
        return

    await session.execute(insert(InvAuditLog).values(**payload))