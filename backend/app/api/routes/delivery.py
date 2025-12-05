"""Delivery entry related API endpoints."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import bindparam, func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.config import settings
from app.core.db import get_session, repeatable_read_transaction
from app.core.db_errors import raise_on_lock_conflict
from app.core.db_retry import with_db_retry
from app.core.optimistic_lock import _ensure_expected_timestamp
from app.core.idempotency import (
    IdempotencyClaimState,
    bump_idempotency_heartbeat,
    claim_idempotency_key,
    complete_idempotency_key,
    require_idempotency_key,
)
from app.core.deps import get_current_user
from app.models.inv_delivery_entry import InvDeliveryDtl, InvDeliveryHdr
from app.models.inv_production_entry import InvProductionDtl
from app.models.inv_sales_order import InvSoHdr, InvSoSubDtl
from app.models.inv_user import InvUserMaster
from app.schemas.delivery import (
    DeliveryEntryItemPayload,
    DeliveryEntryOut,
    DeliveryEntryPayload,
    DeliveryEntryValidationItemOut,
    DeliveryEntryValidationItemPayload,
    DeliveryEntryValidationOut,
    DeliveryEntryValidationPayload,
)

router = APIRouter(prefix="/delivery-entries", tags=["delivery-entries"])

TWO_PLACES = Decimal("0.01")


def _quantise(value: Decimal, scale: Decimal = TWO_PLACES) -> Decimal:
    return value.quantize(scale)


def _normalise_voucher(value: str) -> str:
    return (value or "").strip().upper()


def _normalise_key_token(value: Any) -> str:
    token = str(value or "").strip().lower()
    return "".join(ch for ch in token if ch.isalnum())


def _delivery_detail_key(prod_name: Any, part_no: Any) -> tuple[str, str]:
    return (
        _normalise_key_token(prod_name),
        _normalise_key_token(part_no),
    )


def _delivery_group_key(
    so_no: Any, prod_name: Any, part_no: Any, dely_date: date | None
) -> tuple[str, str, str, date | None]:
    return (
        _normalise_key_token(so_no),
        _normalise_key_token(prod_name),
        _normalise_key_token(part_no),
        dely_date,
    )


def _sanitise_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _enumerate_sales_order_details(
    details: Sequence[InvSoSubDtl],
) -> list[tuple[int, InvSoSubDtl]]:
    return [(index + 1, detail) for index, detail in enumerate(details)]


async def _fetch_sales_order_details(
    session: AsyncSession, so_no: str, *, for_update: bool = False
) -> list[InvSoSubDtl]:
    normalised_voucher = _normalise_voucher(so_no)
    stmt = (
        select(InvSoSubDtl)
        .where(InvSoSubDtl.so_no == normalised_voucher)
        .order_by(InvSoSubDtl.so_prod_name, InvSoSubDtl.so_part_no)
    )
    if for_update:
        stmt = stmt.with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    result = await session.execute(stmt)
    details = result.scalars().all()
    return list(details)


async def _fetch_production_min_dates(
    session: AsyncSession, so_no: str
) -> dict[tuple[str, str], date]:
    result = await session.execute(
        select(
            InvProductionDtl.so_prod_name,
            InvProductionDtl.so_part_no,
            func.min(InvProductionDtl.prod_date),
        )
        .where(InvProductionDtl.so_no == so_no)
        .group_by(InvProductionDtl.so_prod_name, InvProductionDtl.so_part_no)
    )
    return {
        _delivery_detail_key(prod_name, part_no): prod_date
        for prod_name, part_no, prod_date in result
        if prod_date is not None
    }


def _serialise_delivery_entry(
    so_header: InvSoHdr,
    so_details: Sequence[InvSoSubDtl],
    entry: InvDeliveryHdr | None,
) -> DeliveryEntryOut:
    enumerated_details = _enumerate_sales_order_details(so_details)
    entry_totals_by_key: dict[tuple[str, str], Decimal] = {}
    if entry:
        for detail in entry.items:
            quantity = Decimal(detail.dely_qty or Decimal("0"))
            key = _delivery_detail_key(detail.so_prod_name, detail.so_part_no)
            existing = entry_totals_by_key.get(key, Decimal("0"))
            entry_totals_by_key[key] = existing + quantity

    serialised_items = []
    for line_no, so_item in enumerated_details:
        produced_qty = Decimal(so_item.prod_qty or Decimal("0"))
        delivered_qty = Decimal(so_item.dely_qty or Decimal("0"))
        stock_qty = Decimal(so_item.stk_qty or Decimal("0"))
        if stock_qty < 0:
            stock_qty = Decimal("0")
        theoretical_stock = produced_qty - delivered_qty
        if theoretical_stock < 0:
            theoretical_stock = Decimal("0")
        if theoretical_stock < stock_qty:
            stock_qty = theoretical_stock
        lookup_key = _delivery_detail_key(so_item.so_prod_name, so_item.so_part_no)
        entry_qty = entry_totals_by_key.get(lookup_key, Decimal("0"))
        serialised_items.append(
            {
                "line_no": line_no,
                "description": so_item.so_prod_name,
                "part_no": so_item.so_part_no,
                "due_on": None,
                "so_qty": so_item.so_qty,
                "dely_qty": _quantise(entry_qty),
                "stock_qty": _quantise(stock_qty),
            }
        )

    header = {
        "so_voucher_no": so_header.so_no,
        "so_voucher_date": so_header.so_date,
        "company_code": so_header.company_code,
        "company_name": so_header.company_name,
        "client_code": so_header.client_code,
        "client_name": so_header.client_name,
        "dely_date": entry.delivery_date if entry else None,
        "created_by": entry.created_by if entry else None,
        "created_at": entry.created_at if entry else None,
        "updated_by": entry.updated_by if entry else None,
        "updated_at": entry.updated_at if entry else None,
    }

    return DeliveryEntryOut(header=header, items=serialised_items, has_entry=entry is not None)


async def _load_delivery_entry_response(
    session: AsyncSession, so_no: str
) -> DeliveryEntryOut | None:
    so_header = await session.scalar(
        select(InvSoHdr).where(InvSoHdr.so_no == so_no)
    )
    if not so_header:
        return None
    _ensure_sales_order_open(so_header, so_header.created_by or "system")
    so_details = await _fetch_sales_order_details(session, so_header.so_no)
    entry = await session.scalar(
        select(InvDeliveryHdr)
        .options(selectinload(InvDeliveryHdr.items))
        .where(InvDeliveryHdr.so_no == so_no)
    )
    return _serialise_delivery_entry(so_header, so_details, entry)


def _ensure_sales_order_open(so_header: InvSoHdr, user_code: str) -> None:
    """Ensure the related sales order reflects an open status."""

    normalised_status = (so_header.so_status or "").strip().upper()
    if normalised_status == "O":
        return

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Only open sales orders can be delivered.",
    )


async def _sync_sales_order_delivery_totals(session: AsyncSession, so_no: str) -> None:
    so_no = _normalise_voucher(so_no)

    # Lock detail rows and aggregate in Python.
    rows = await session.execute(
        select(InvDeliveryDtl.so_prod_name, InvDeliveryDtl.so_part_no, InvDeliveryDtl.dely_qty)
        .where(InvDeliveryDtl.so_no == so_no)
        .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    )

    totals_by_key: dict[tuple[str, str], Decimal] = {}
    for prod, part, qty in rows:
        k = _delivery_detail_key(prod, part)
        totals_by_key[k] = totals_by_key.get(k, Decimal("0")) + _quantise(Decimal(qty or 0))

    # Lock SO sub-details and write back totals.
    so_rows = await session.execute(
        select(InvSoSubDtl).where(InvSoSubDtl.so_no == so_no).with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    )
    for d in so_rows.scalars():
        k = _delivery_detail_key(d.so_prod_name, d.so_part_no)
        d.dely_qty = _quantise(totals_by_key.get(k, Decimal("0")))


async def _try_increment_delivery_total(
    session: AsyncSession, so_no: str, prod_name: str, part_no: str, inc: Decimal
) -> bool:
    """Attempt to increment delivery totals with a DB guard to avoid overflow."""

    stmt = (
        update(InvSoSubDtl)
        .where(
            InvSoSubDtl.so_no == so_no,
            InvSoSubDtl.so_prod_name == prod_name,
            InvSoSubDtl.so_part_no == part_no,
            (InvSoSubDtl.dely_qty + bindparam("delta")) <= InvSoSubDtl.so_qty,
            (InvSoSubDtl.dely_qty + bindparam("delta")) <= InvSoSubDtl.prod_qty,
        )
        .values(dely_qty=InvSoSubDtl.dely_qty + bindparam("delta"))
    )
    result = await session.execute(stmt, {"delta": inc})
    return result.rowcount == 1


def _prepare_delivery_items(
    so_header: InvSoHdr,
    so_details: Sequence[InvSoSubDtl],
    items: list[DeliveryEntryItemPayload],
    dely_date: date,
    existing_entry: InvDeliveryHdr | None = None,
    production_min_dates: Mapping[tuple[str, str], date] | None = None,
) -> list[InvDeliveryDtl]:
    production_min_dates = production_min_dates or {}
    enumerated_details = _enumerate_sales_order_details(so_details)
    if not enumerated_details:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales order has no line items to deliver.",
        )

    aggregated_by_line: dict[int, Decimal] = {}
    for item in items:
        line_no = item.line_no
        quantity = Decimal(item.dely_qty)
        if quantity < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Delivery quantity for line {line_no} cannot be negative.",
            )
        aggregated_by_line[line_no] = aggregated_by_line.get(line_no, Decimal("0")) + quantity

    detail_by_line = {line_no: detail for line_no, detail in enumerated_details}
    so_line_numbers = set(detail_by_line)
    unknown_lines = sorted(set(aggregated_by_line) - so_line_numbers)
    if unknown_lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Line numbers {unknown_lines} do not exist on the sales order.",
        )

    existing_totals_by_key: dict[tuple[str, str], Decimal] = {}
    if existing_entry:
        for detail in existing_entry.items:
            quantity = Decimal(detail.dely_qty or Decimal("0"))
            key = _delivery_detail_key(detail.so_prod_name, detail.so_part_no)
            existing_totals_by_key[key] = existing_totals_by_key.get(key, Decimal("0")) + quantity

    prepared: list[InvDeliveryDtl] = []
    for line_no, dely_qty in sorted(aggregated_by_line.items()):
        detail = detail_by_line.get(line_no)
        if not detail:
            continue
        if dely_qty <= 0:
            continue
        produced_qty = Decimal(detail.prod_qty or Decimal("0"))
        delivered_qty = Decimal(detail.dely_qty or Decimal("0"))
        base_stock_qty = Decimal(detail.stk_qty or Decimal("0"))
        detail_key = _delivery_detail_key(detail.so_prod_name, detail.so_part_no)
        if detail_key in existing_totals_by_key:
            adjustment = existing_totals_by_key[detail_key]
            delivered_qty -= adjustment
            base_stock_qty += adjustment
            if delivered_qty < 0:
                delivered_qty = Decimal("0")
        stock_qty = produced_qty - delivered_qty
        if stock_qty < 0:
            stock_qty = Decimal("0")
        if base_stock_qty < 0:
            base_stock_qty = Decimal("0")
        available_qty = min(stock_qty, base_stock_qty)
        detail_part = _sanitise_text(detail.so_part_no)
        if not detail_part:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Sales order line {line_no} is missing a part number and cannot be delivered. "
                    "Update the sales order before recording delivery."
                ),
            )
        if dely_qty > available_qty:
            available_display = f"{_quantise(available_qty):.2f}"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Delivery quantity would exceed available stock for "
                    f"line {line_no} (Available: {available_display})."
                ),
            )

    for item in items:
        detail = detail_by_line.get(item.line_no)
        if not detail:
            continue
        quantity = Decimal(item.dely_qty)
        if quantity <= 0:
            continue
        item_date = item.dely_date or dely_date
        if item_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Delivery date is required for line {item.line_no}.",
            )
        detail_part = _sanitise_text(detail.so_part_no)
        if not detail_part:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Sales order line {item.line_no} is missing a part number and cannot be delivered. "
                    "Update the sales order before recording delivery."
                ),
            )
        production_date = production_min_dates.get(
            _delivery_detail_key(detail.so_prod_name, detail.so_part_no)
        )
        if production_date is not None and item_date < production_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Delivery Date cannot be earlier than production date "
                    f"for line {item.line_no} (Production Date: {production_date.strftime('%d-%m-%Y')})."
                ),
            )
        prepared.append(
            InvDeliveryDtl(
                so_no=so_header.so_no,
                so_prod_name=detail.so_prod_name,
                so_part_no=detail_part,
                dely_date=item_date,
                dely_qty=_quantise(quantity),
            )
        )

    if not prepared:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one delivery line item must have a quantity greater than zero.",
        )

    return prepared


def _apply_grouped_delivery_items(
    entry: InvDeliveryHdr, prepared_items: Iterable[InvDeliveryDtl]
) -> None:
    grouped: dict[tuple[str, str, str, date | None], Decimal] = {}
    exemplars: dict[tuple[str, str, str, date | None], InvDeliveryDtl] = {}
    for item in prepared_items:
        key = _delivery_group_key(item.so_no, item.so_prod_name, item.so_part_no, item.dely_date)
        existing = grouped.get(key, Decimal("0"))
        grouped[key] = existing + Decimal(item.dely_qty or Decimal("0"))
        exemplars.setdefault(key, item)

    if not grouped:
        return

    existing_index: dict[tuple[str, str, str, date | None], InvDeliveryDtl] = {}
    for detail in entry.items:
        key = _delivery_group_key(
            detail.so_no,
            detail.so_prod_name,
            detail.so_part_no,
            detail.dely_date,
        )
        existing_index[key] = detail

    for key, quantity in grouped.items():
        existing_detail = existing_index.get(key)
        exemplar = exemplars.get(key)
        if exemplar is None:
            continue
        if existing_detail:
            current_qty = Decimal(existing_detail.dely_qty or Decimal("0"))
            existing_detail.dely_qty = _quantise(current_qty + quantity)
            existing_detail.so_prod_name = exemplar.so_prod_name
            existing_detail.so_part_no = exemplar.so_part_no
        else:
            entry.items.append(
                InvDeliveryDtl(
                    so_no=entry.so_no,
                    so_prod_name=exemplar.so_prod_name,
                    so_part_no=exemplar.so_part_no,
                    dely_date=exemplar.dely_date,
                    dely_qty=_quantise(quantity),
                )
            )


def _aggregate_totals_by_product(
    items: Iterable[InvDeliveryDtl],
) -> dict[tuple[str, str], tuple[str, str, Decimal]]:
    totals: dict[tuple[str, str], Decimal] = {}
    exemplars: dict[tuple[str, str], tuple[str, str]] = {}
    for item in items:
        key = _delivery_detail_key(item.so_prod_name, item.so_part_no)
        totals[key] = totals.get(key, Decimal("0")) + _quantise(
            Decimal(item.dely_qty or Decimal("0"))
        )
        exemplars.setdefault(key, (item.so_prod_name, item.so_part_no))
    return {
        key: (exemplars[key][0], exemplars[key][1], qty) for key, qty in totals.items()
    }


@router.post("/validate", response_model=DeliveryEntryValidationOut)
async def validate_delivery_entry(
    payload: DeliveryEntryValidationPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> DeliveryEntryValidationOut:
    voucher = _normalise_voucher(payload.so_voucher_no)
    if not voucher:
        return DeliveryEntryValidationOut(valid=False, items=[])

    so_header = await session.scalar(
        select(InvSoHdr).where(InvSoHdr.so_no == voucher)
    )
    if not so_header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

    _ensure_sales_order_open(so_header, user.inv_user_code)

    so_details = await _fetch_sales_order_details(session, so_header.so_no)
    if not so_details:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales order has no line items to validate.",
        )

    enumerated_details = _enumerate_sales_order_details(so_details)
    detail_by_line = {line_no: detail for line_no, detail in enumerated_details}
    detail_by_key = {
        (
            _normalise_key_token(detail.so_prod_name),
            _normalise_key_token(detail.so_part_no),
        ): (line_no, detail)
        for line_no, detail in enumerated_details
    }

    production_min_dates = await _fetch_production_min_dates(session, voucher)

    delivery_totals_result = await session.execute(
        select(
            InvDeliveryDtl.so_prod_name,
            InvDeliveryDtl.so_part_no,
            func.sum(InvDeliveryDtl.dely_qty),
        )
        .where(InvDeliveryDtl.so_no == voucher)
        .group_by(InvDeliveryDtl.so_prod_name, InvDeliveryDtl.so_part_no)
    )
    delivery_totals_by_key: dict[tuple[str, str], Decimal] = {}
    for prod_name, part_no, total in delivery_totals_result:
        quantity = Decimal(total or 0)
        key = _delivery_detail_key(prod_name, part_no)
        delivery_totals_by_key[key] = quantity

    evaluated_items: list[
        tuple[
            DeliveryEntryValidationItemPayload,
            InvSoSubDtl | None,
            tuple[str, str] | None,
            int | None,
        ]
    ] = []
    line_new_totals: dict[int, Decimal] = {}
    line_previous_totals: dict[int, Decimal] = {}

    for item in payload.items:
        matched_detail = None
        matched_line_no: int | None = None
        detail_key: tuple[str, str] | None = None
        if item.line_no is not None:
            matched_detail = detail_by_line.get(item.line_no)
            if matched_detail is not None:
                matched_line_no = item.line_no
        if matched_detail is None and (item.description or item.part_no):
            desc_key = _normalise_key_token(item.description)
            part_key = _normalise_key_token(item.part_no)
            match = detail_by_key.get((desc_key, part_key))
            if match is not None:
                matched_line_no, matched_detail = match

        new_qty = Decimal(item.dely_qty)
        previous_qty = Decimal(item.previous_dely_qty or 0)
        if matched_detail is not None:
            detail_key = (
                _normalise_key_token(matched_detail.so_prod_name),
                _normalise_key_token(matched_detail.so_part_no),
            )
        evaluated_items.append((item, matched_detail, detail_key, matched_line_no))
        if matched_detail is None:
            continue
        if matched_line_no is None:
            continue
        line_no = matched_line_no
        line_new_totals[line_no] = line_new_totals.get(line_no, Decimal("0")) + new_qty
        line_previous_totals[line_no] = line_previous_totals.get(line_no, Decimal("0")) + previous_qty

    result_items: list[DeliveryEntryValidationItemOut] = []
    valid = True
    for item, matched_detail, detail_key, matched_line_no in evaluated_items:
        error: str | None = None
        line_no = item.line_no
        trimmed_part_no = _sanitise_text(item.part_no)
        if not trimmed_part_no:
            error = "Part number is required for each delivery line."
        if matched_detail is None and error is None:
            error = "Sales order line could not be identified for this item."
        elif matched_detail is not None:
            line_no = matched_line_no if matched_line_no is not None else item.line_no
            matched_part = _sanitise_text(matched_detail.so_part_no)
            if error is None and not matched_part:
                error = (
                    f"Sales order line {line_no} is missing a part number and cannot be delivered. "
                    "Update the sales order before recording delivery."
                )
            if error is None:
                produced_qty = Decimal(matched_detail.prod_qty or 0)
                base_stock = Decimal(matched_detail.stk_qty or 0)
                lookup_key = detail_key or ("", "")
                existing_total = delivery_totals_by_key.get(lookup_key, Decimal("0"))
                aggregated_previous = line_previous_totals.get(line_no, Decimal("0"))
                aggregated_new = line_new_totals.get(line_no, Decimal("0"))
                adjusted_existing = existing_total - aggregated_previous
                if adjusted_existing < 0:
                    adjusted_existing = Decimal("0")
                available_capacity = produced_qty - adjusted_existing
                if available_capacity < 0:
                    available_capacity = Decimal("0")
                base_adjusted_capacity = base_stock + aggregated_previous
                if base_adjusted_capacity < 0:
                    base_adjusted_capacity = Decimal("0")
                if base_adjusted_capacity < available_capacity:
                    available_capacity = base_adjusted_capacity
                if aggregated_new > available_capacity:
                    available_display = f"{_quantise(available_capacity):.2f}"
                    error = (
                        "Delivery Qty exceeds available stock "
                        f"(Available: {available_display})"
                    )

        if error is None and item.dely_date is not None:
            production_lookup_key = detail_key
            if production_lookup_key is None and matched_detail is not None:
                production_lookup_key = _delivery_detail_key(
                    matched_detail.so_prod_name, matched_detail.so_part_no
                )
            production_min_date = (
                production_min_dates.get(production_lookup_key)
                if production_lookup_key is not None
                else None
            )
            if production_min_date is not None and item.dely_date < production_min_date:
                error = (
                    "Delivery Date cannot be earlier than production date "
                    f"(Production Date: {production_min_date.strftime('%d-%m-%Y')})"
                )

        if error is None and item.dely_date is None:
            error = "Delivery date is required for each delivery line."

        if error:
            valid = False

        result_items.append(
            DeliveryEntryValidationItemOut(
                line_no=line_no,
                description=item.description,
                part_no=item.part_no,
                error=error,
            )
        )

    response = DeliveryEntryValidationOut(valid=valid, items=result_items)

    await log_audit(
        session,
        user.inv_user_code,
        "delivery_entry",
        voucher,
        "VALIDATE",
        details={"item_count": len(result_items), "valid": response.valid},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return response


@router.get("/check")
async def check_delivery_entry(
    request: Request,
    so_voucher_no: str,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    voucher = _normalise_voucher(so_voucher_no)
    if not voucher:
        return {"exists": False}

    stmt = select(func.count()).select_from(InvDeliveryHdr).where(InvDeliveryHdr.so_no == voucher)
    exists = (await session.execute(stmt)).scalar_one() > 0

    await log_audit(
        session,
        user.inv_user_code,
        "delivery_entry",
        voucher,
        "CHECK_EXISTS",
        details={"exists": exists},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return {"exists": exists}


@router.get("/{so_voucher_no}", response_model=DeliveryEntryOut)
async def get_delivery_entry(
    so_voucher_no: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> DeliveryEntryOut:
    voucher = _normalise_voucher(so_voucher_no)

    so_header = await session.scalar(
        select(InvSoHdr).where(InvSoHdr.so_no == voucher)
    )
    if not so_header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

    _ensure_sales_order_open(so_header, user.inv_user_code)

    so_details = await _fetch_sales_order_details(session, so_header.so_no)

    entry = await session.scalar(
        select(InvDeliveryHdr)
        .options(selectinload(InvDeliveryHdr.items))
        .where(InvDeliveryHdr.so_no == voucher)
    )

    response = _serialise_delivery_entry(so_header, so_details, entry)

    await log_audit(
        session,
        user.inv_user_code,
        "delivery_entry",
        voucher,
        "FETCH",
        details={"has_entry": response.has_entry},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return response


@router.post("", response_model=DeliveryEntryOut)
async def create_delivery_entry(
    payload: DeliveryEntryPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> DeliveryEntryOut:
    voucher = _normalise_voucher(payload.so_voucher_no)
    if not voucher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales order / voucher number is required.",
        )
    idempotency_key = require_idempotency_key(request)

    async def _create_once() -> DeliveryEntryOut:
        async with repeatable_read_transaction(session):
            claim = await claim_idempotency_key(
                session,
                idempotency_key=idempotency_key,
                resource="delivery_entry",
            )
            if (
                claim.state == IdempotencyClaimState.REPLAY
                and claim.record
                and claim.record.resource_id
            ):
                existing = await _load_delivery_entry_response(
                    session, claim.record.resource_id
                )
                if existing:
                    return existing
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Original request completed but delivery entry was not found.",
                )
            if claim.state == IdempotencyClaimState.IN_PROGRESS:
                retry_after = str(claim.retry_after or 1)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Another request with this Idempotency-Key is in progress. Please retry shortly.",
                    headers={"Retry-After": retry_after},
                )

            await bump_idempotency_heartbeat(
                session, idempotency_key=idempotency_key
            )

            so_header = await session.scalar(
                select(InvSoHdr)
                .where(InvSoHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not so_header:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Sales order not found.",
                )

            _ensure_sales_order_open(so_header, user.inv_user_code)

            so_details = await _fetch_sales_order_details(
                session, so_header.so_no, for_update=True
            )

            existing_entry = await session.scalar(
                select(InvDeliveryHdr.so_no)
                .where(InvDeliveryHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if existing_entry is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Delivery entry already exists.",
                )

            prepared_items = _prepare_delivery_items(
                so_header,
                so_details,
                payload.items,
                payload.dely_date,
                production_min_dates=await _fetch_production_min_dates(
                    session, so_header.so_no
                ),
            )

            previous_totals: dict[tuple[str, str], tuple[str, str, Decimal]] = {}
            new_totals = _aggregate_totals_by_product(prepared_items)
            for key in set(previous_totals) | set(new_totals):
                names = new_totals.get(key) or previous_totals.get(key)
                if not names:
                    continue
                new_qty = new_totals.get(key, (names[0], names[1], Decimal("0")))[2]
                prev_qty = previous_totals.get(
                    key, (names[0], names[1], Decimal("0"))
                )[2]
                delta = new_qty - prev_qty
                if delta == 0:
                    continue
                ok = await _try_increment_delivery_total(
                    session, so_header.so_no, names[0], names[1], delta
                )
                if not ok:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Delivery exceeds available capacity",
                    )

            entry = InvDeliveryHdr(
                so_no=so_header.so_no,
                delivery_date=payload.dely_date,
                created_by=user.inv_user_code,
            )
            session.add(entry)

            _apply_grouped_delivery_items(entry, prepared_items)

            await session.flush()
            await _sync_sales_order_delivery_totals(session, so_header.so_no)

            response = await _load_delivery_entry_response(session, so_header.so_no)
            if not response:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to load saved delivery entry.",
                )

            await log_audit(
                session,
                user.inv_user_code,
                "delivery_entry",
                voucher,
                "CREATE",
                details={"item_count": len(prepared_items)},
                remote_addr=(request.client.host if request.client else None),
            )
            await complete_idempotency_key(
                session, idempotency_key=idempotency_key, resource_id=so_header.so_no
            )
            return response

    try:
        return await with_db_retry(session, _create_once)
    except OperationalError as exc:
        raise_on_lock_conflict(exc)


@router.put("/{so_voucher_no}", response_model=DeliveryEntryOut)
async def update_delivery_entry(
    so_voucher_no: str,
    payload: DeliveryEntryPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> DeliveryEntryOut:
    voucher = _normalise_voucher(so_voucher_no)

    async def _update_once() -> DeliveryEntryOut:
        async with repeatable_read_transaction(session):
            so_header = await session.scalar(
                select(InvSoHdr)
                .where(InvSoHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not so_header:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Sales order not found.",
                )

            _ensure_sales_order_open(so_header, user.inv_user_code)

            so_details = await _fetch_sales_order_details(
                session, so_header.so_no, for_update=True
            )

            entry = await session.scalar(
                select(InvDeliveryHdr)
                .options(selectinload(InvDeliveryHdr.items))
                .where(InvDeliveryHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if entry is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Delivery entry not found.",
                )

            _ensure_expected_timestamp(entry.updated_at, payload.expected_updated_at)

            payload_voucher = _normalise_voucher(payload.so_voucher_no)
            if payload_voucher and payload_voucher != so_header.so_no:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sales order / voucher number cannot be changed.",
                )

            prepared_items = _prepare_delivery_items(
                so_header,
                so_details,
                payload.items,
                payload.dely_date,
                existing_entry=entry,
                production_min_dates=await _fetch_production_min_dates(
                    session, so_header.so_no
                ),
            )

            previous_totals = _aggregate_totals_by_product(entry.items)
            new_totals = _aggregate_totals_by_product(prepared_items)
            for key in set(previous_totals) | set(new_totals):
                names = new_totals.get(key) or previous_totals.get(key)
                if not names:
                    continue
                new_qty = new_totals.get(key, (names[0], names[1], Decimal("0")))[2]
                prev_qty = previous_totals.get(
                    key, (names[0], names[1], Decimal("0"))
                )[2]
                delta = new_qty - prev_qty
                if delta == 0:
                    continue
                ok = await _try_increment_delivery_total(
                    session, so_header.so_no, names[0], names[1], delta
                )
                if not ok:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Delivery exceeds available capacity",
                    )

            entry.delivery_date = payload.dely_date
            entry.updated_by = user.inv_user_code
            entry.updated_at = datetime.now()
            _apply_grouped_delivery_items(entry, prepared_items)

            await session.flush()
            await _sync_sales_order_delivery_totals(session, so_header.so_no)

            so_details = await _fetch_sales_order_details(session, so_header.so_no)

            fresh_entry = await session.scalar(
                select(InvDeliveryHdr)
                .options(selectinload(InvDeliveryHdr.items))
                .where(InvDeliveryHdr.so_no == voucher)
            )
            if not fresh_entry:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to load saved delivery entry.",
                )

            response = _serialise_delivery_entry(so_header, so_details, fresh_entry)

            await log_audit(
                session,
                user.inv_user_code,
                "delivery_entry",
                voucher,
                "UPDATE",
                details={"item_count": len(prepared_items)},
                remote_addr=(request.client.host if request.client else None),
            )

            return response

    try:
        return await with_db_retry(session, _update_once)
    except OperationalError as exc:
        raise_on_lock_conflict(exc)
