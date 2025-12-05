from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.db import get_session
from app.core.deps import get_current_user
from app.models.inv_currency import InvCurrencyMaster
from app.models.inv_user import InvUserMaster
from app.schemas.currency import CurrencyOut

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=List[CurrencyOut])
async def list_currencies(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> List[CurrencyOut]:
    stmt = select(InvCurrencyMaster).order_by(InvCurrencyMaster.currency_code)
    result = await session.execute(stmt)
    items = result.scalars().all()

    await log_audit(
        session,
        user.inv_user_code,
        "currency",
        None,
        "LIST",
        details={"count": len(items)},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return items