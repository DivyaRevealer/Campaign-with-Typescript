"""API endpoints that expose summary report data."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import get_current_user
from app.models.inv_sales_order import InvSoSubDtl
from app.models.inv_user import InvUserMaster
from app.schemas.summary_report import SummaryReportItemOut, SummaryReportOut

router = APIRouter(prefix="/summary-reports", tags=["summary-reports"])

_TWO_PLACES = Decimal("0.01")


def _format_quantity(value: Decimal | None) -> str:
    """Return a human friendly representation of a quantity value."""

    if value is None:
        return "0"
    quantised = value.quantize(_TWO_PLACES)
    text = format(quantised, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _safe_decimal(value: Decimal | None) -> Decimal:
    """Normalise nullable database values into decimals."""

    return value if value is not None else Decimal("0")


@router.get("/{so_no}", response_model=SummaryReportOut)
async def get_summary_report(
    so_no: str,
    session: AsyncSession = Depends(get_session),
    _: InvUserMaster = Depends(get_current_user),
) -> SummaryReportOut:
    """Return summary rows for the provided sales order number."""

    normalised = so_no.strip()
    if not normalised:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales Order No is required.",
        )

    statement = (
        select(InvSoSubDtl)
        .where(InvSoSubDtl.so_no == normalised)
        .order_by(InvSoSubDtl.so_prod_name, InvSoSubDtl.so_part_no)
    )
    details = (await session.execute(statement)).scalars().all()

    items: list[SummaryReportItemOut] = []

    for sub_detail in details:
        ordered = _safe_decimal(sub_detail.so_qty)
        delivered = _safe_decimal(sub_detail.dely_qty)
        produced = _safe_decimal(sub_detail.prod_qty)
        stock_in_hand = _safe_decimal(sub_detail.stk_qty)
        yet_to_deliver = ordered - delivered
        yet_to_produce = ordered - produced
        items.append(
            SummaryReportItemOut(
                description=sub_detail.so_prod_name,
                part_no=sub_detail.so_part_no,
                ordered_qty=_format_quantity(ordered),
                delivered_qty=_format_quantity(delivered),
                yet_to_deliver_qty=_format_quantity(yet_to_deliver),
                stock_in_hand_qty=_format_quantity(stock_in_hand),
                yet_to_produce_qty=_format_quantity(yet_to_produce),
            )
        )

    return SummaryReportOut(so_no=normalised, items=items)