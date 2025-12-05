"""API endpoints that expose production report data."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import get_current_user
from app.models.inv_production_entry import InvProductionDtl
from app.models.inv_user import InvUserMaster
from app.schemas.production_report import ProductionReportItemOut, ProductionReportOut

router = APIRouter(prefix="/production-reports", tags=["production-reports"])

_TWO_PLACES = Decimal("0.01")


def _format_quantity(value: Decimal | None) -> str:
    """Return a human friendly representation of a production quantity."""

    if value is None:
        return "0"
    quantised = value.quantize(_TWO_PLACES)
    text = format(quantised, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _sort_key(detail: InvProductionDtl) -> tuple[str, date | None]:
    """Sort key that matches the requested ordering from the UI."""

    return ((detail.so_prod_name or "").lower(), detail.prod_date)


@router.get("/{so_no}", response_model=ProductionReportOut)
async def get_production_report(
    so_no: str,
    session: AsyncSession = Depends(get_session),
    _: InvUserMaster = Depends(get_current_user),
) -> ProductionReportOut:
    """Return production rows for the provided sales order number."""

    normalised = so_no.strip()
    if not normalised:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales Order No is required.",
        )

    result = await session.execute(
        select(InvProductionDtl).where(InvProductionDtl.so_no == normalised)
    )
    details = sorted(result.scalars().all(), key=_sort_key)

    items = [
        ProductionReportItemOut(
            description=detail.so_prod_name,
            part_no=detail.so_part_no,
            prod_date=detail.prod_date,
            prod_qty=_format_quantity(detail.prod_qty),
        )
        for detail in details
    ]

    return ProductionReportOut(so_no=normalised, items=items)