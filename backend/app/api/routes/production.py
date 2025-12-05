"""Production entry related API endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Mapping, Sequence

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
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
from app.models.inv_production_entry import InvProductionDtl, InvProductionHdr
from app.models.inv_sales_order import InvSoHdr, InvSoSubDtl
from app.models.inv_user import InvUserMaster
from app.schemas.production import (
    ProductionEntryItemPayload,
    ProductionEntryOut,
    ProductionEntryPayload,
    ProductionEntryValidationItemPayload,
    ProductionEntryValidationItemOut,
    ProductionEntryValidationOut,
    ProductionEntryValidationPayload,
)

router = APIRouter(prefix="/production-entries", tags=["production-entries"])

TWO_PLACES = Decimal("0.01")

def _quantise(value: Decimal, scale: Decimal = TWO_PLACES) -> Decimal:
    return value.quantize(scale)


def _normalise_voucher(value: str | None) -> str:
    return (value or "").strip().upper()


def _normalise_key_token(value: Any) -> str:
    token = str(value or "").strip().lower()
    return "".join(ch for ch in token if ch.isalnum())


async def _load_sales_order_details(
    session: AsyncSession, so_no: str, *, for_update: bool = False
) -> list[InvSoSubDtl]:
    """Fetch aggregated sales order detail lines for a sales order."""

    normalised_voucher = _normalise_voucher(so_no)
    stmt = (
        select(InvSoSubDtl)
        .where(InvSoSubDtl.so_no == normalised_voucher)
        .order_by(InvSoSubDtl.so_prod_name, InvSoSubDtl.so_part_no)
    )
    if for_update:
        stmt = stmt.with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    result = await session.execute(stmt)
    return list(result.scalars().all())


def _enumerate_sales_order_details(
    so_details: Sequence[InvSoSubDtl],
) -> tuple[
    list[tuple[int, InvSoSubDtl]],
    dict[int, InvSoSubDtl],
    dict[tuple[str, str], InvSoSubDtl],
    dict[tuple[str, str], int],
]:
    """Generate lookup structures for aggregated sales order details."""

    ordered: list[tuple[int, InvSoSubDtl]] = []
    detail_by_line: dict[int, InvSoSubDtl] = {}
    detail_by_key: dict[tuple[str, str], InvSoSubDtl] = {}
    line_lookup: dict[tuple[str, str], int] = {}

    for index, detail in enumerate(so_details, start=1):
        ordered.append((index, detail))
        detail_by_line[index] = detail
        key = (
            _normalise_key_token(detail.so_prod_name),
            _normalise_key_token(detail.so_part_no),
        )
        detail_by_key[key] = detail
        line_lookup[key] = index

    return ordered, detail_by_line, detail_by_key, line_lookup


def _serialise_production_entry(
    so_header: InvSoHdr,
    so_details: Sequence[InvSoSubDtl],
    entry: InvProductionHdr | None,
) -> ProductionEntryOut:
    ordered_items, _, _, _ = _enumerate_sales_order_details(so_details)
    entry_totals: dict[tuple[str, str], Decimal] = {}
    if entry:
        for detail in entry.items:
            key = (
                _normalise_key_token(detail.so_prod_name),
                _normalise_key_token(detail.so_part_no),
            )
            existing = entry_totals.get(key, Decimal("0"))
            entry_totals[key] = existing + Decimal(detail.prod_qty or Decimal("0"))

    serialised_items = []
    for line_no, so_item in ordered_items:
        so_qty = Decimal(so_item.so_qty or Decimal("0"))
        lookup_key = (
            _normalise_key_token(so_item.so_prod_name),
            _normalise_key_token(so_item.so_part_no),
        )
        prod_qty = entry_totals.get(lookup_key, Decimal("0"))
        if prod_qty < 0:
            prod_qty = Decimal("0")
        bal_qty = so_qty - prod_qty
        if bal_qty < 0:
            bal_qty = Decimal("0")
        serialised_items.append(
            {
                "line_no": line_no,
                "description": so_item.so_prod_name,
                "part_no": so_item.so_part_no,
                "due_on": None,
                "so_qty": float(_quantise(so_qty)),
                "prod_qty": float(_quantise(prod_qty)),
                "bal_qty": float(_quantise(bal_qty)),
            }
        )

    header = {
        "so_voucher_no": so_header.so_no,
        "so_voucher_date": so_header.so_date,
        "company_code": so_header.company_code,
        "company_name": so_header.company_name,
        "client_code": so_header.client_code,
        "client_name": so_header.client_name,
        "production_date": entry.production_date if entry else None,
        "created_by": entry.created_by if entry else None,
        "created_at": entry.created_at if entry else None,
        "updated_by": entry.updated_by if entry else None,
        "updated_at": entry.updated_at if entry else None,
    }

    return ProductionEntryOut(header=header, items=serialised_items, has_entry=entry is not None)


async def _load_production_entry_response(
    session: AsyncSession, so_no: str
) -> ProductionEntryOut | None:
    so_header = await session.scalar(
        select(InvSoHdr)
        .where(InvSoHdr.so_no == so_no)
        .where(InvSoHdr.so_status == "O")
    )
    if not so_header:
        return None
    so_details = await _load_sales_order_details(session, so_header.so_no)
    entry = await session.scalar(
        select(InvProductionHdr)
        .options(selectinload(InvProductionHdr.items))
        .where(InvProductionHdr.so_no == so_no)
    )
    return _serialise_production_entry(so_header, so_details, entry)


async def _sync_sales_order_production_totals(
    session: AsyncSession, so_no: str
) -> None:
    so_no = _normalise_voucher(so_no)

    detail_rows = await session.execute(
        select(InvProductionDtl.so_prod_name, InvProductionDtl.so_part_no, InvProductionDtl.prod_qty)
        .where(InvProductionDtl.so_no == so_no)
        .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    )

    totals_map: dict[tuple[str, str], Decimal] = {}
    for prod_name, part_no, quantity in detail_rows.all():
        key = (prod_name, part_no)
        totals_map[key] = totals_map.get(key, Decimal("0")) + _quantise(Decimal(quantity or 0))

    so_details_result = await session.execute(
        select(InvSoSubDtl)
        .where(InvSoSubDtl.so_no == so_no)
        .order_by(InvSoSubDtl.so_prod_name, InvSoSubDtl.so_part_no)
        .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    )
    for detail in so_details_result.scalars().all():
        key = (detail.so_prod_name, detail.so_part_no)
        detail.prod_qty = _quantise(totals_map.get(key, Decimal("0")))


async def _fetch_existing_production_totals(
    session: AsyncSession, so_no: str
) -> dict[tuple[str, str], Decimal]:
    so_no = _normalise_voucher(so_no)
    totals_result = await session.execute(
        select(InvProductionDtl.so_prod_name, InvProductionDtl.so_part_no, InvProductionDtl.prod_qty)
        .where(InvProductionDtl.so_no == so_no)
        .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
    )

    totals_map: dict[tuple[str, str], Decimal] = {}
    for prod_name, part_no, quantity in totals_result.all():
        key = (_normalise_key_token(prod_name), _normalise_key_token(part_no))
        totals_map[key] = totals_map.get(key, Decimal("0")) + _quantise(Decimal(quantity or 0))
    return totals_map


@dataclass
class _PreparedProductionItem:
    line_no: int
    detail: InvSoSubDtl
    prod_qty: Decimal
    prod_date: date


def _prepare_production_items(
    so_details: Sequence[InvSoSubDtl],
    items: list[ProductionEntryItemPayload],
    production_date: date,
    existing_totals: Mapping[tuple[str, str], Decimal] | None = None,
) -> list[_PreparedProductionItem]:
    if not so_details:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales order has no line items to produce.",
        )

    _, detail_by_line, _, _ = _enumerate_sales_order_details(so_details)

    so_line_numbers = set(detail_by_line.keys())
    provided_line_numbers = {item.line_no for item in items}
    unknown_lines = sorted(provided_line_numbers - so_line_numbers)
    if unknown_lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Line numbers {unknown_lines} do not exist on the sales order.",
        )

    prepared: list[_PreparedProductionItem] = []
    line_new_totals: dict[int, Decimal] = {}

    for payload_item in items:
        line_no = payload_item.line_no
        detail = detail_by_line.get(line_no)
        if not detail:
            continue

        part_no = (detail.so_part_no or "").strip()
        if not part_no:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Selected sales order line is missing a part number and cannot "
                    "be produced."
                ),
            )

        prod_qty = _quantise(Decimal(payload_item.prod_qty))
        item_prod_date = payload_item.production_date or production_date
        if item_prod_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Production date must be provided for each line item.",
            )
        so_qty = Decimal(detail.so_qty or Decimal("0"))
        lookup_key = (
            _normalise_key_token(detail.so_prod_name),
            _normalise_key_token(detail.so_part_no),
        )
        existing_total = (
            existing_totals.get(lookup_key, Decimal("0"))
            if existing_totals is not None
            else Decimal("0")
        )
        current_total = line_new_totals.get(line_no, Decimal("0"))
        if existing_total + current_total + prod_qty > so_qty:
            so_qty_display = f"{_quantise(so_qty):.2f}"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Cumulative production quantity would exceed the sales order quantity "
                    f"for line {line_no} (SO Qty: {so_qty_display})."
                ),
            )

        line_new_totals[line_no] = current_total + prod_qty
        prepared.append(
            _PreparedProductionItem(
                line_no=line_no,
                detail=detail,
                prod_qty=prod_qty,
                prod_date=item_prod_date,
            )
        )

    if not prepared:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one production line item must have a quantity greater than zero.",
        )

    return prepared


def _apply_prepared_production_items(
    entry: InvProductionHdr,
    prepared_items: list[_PreparedProductionItem],
) -> None:
    if not prepared_items:
        return

    key_map: dict[tuple[str, str, date], InvProductionDtl] = {}
    for existing_detail in entry.items:
        key = (
            existing_detail.so_prod_name,
            existing_detail.so_part_no,
            existing_detail.prod_date,
        )
        key_map[key] = existing_detail

    aggregated: dict[tuple[str, str, date], Decimal] = {}
    detail_lookup: dict[tuple[str, str, date], InvSoSubDtl] = {}
    for item in prepared_items:
        key = (item.detail.so_prod_name, item.detail.so_part_no, item.prod_date)
        aggregated[key] = aggregated.get(key, Decimal("0")) + item.prod_qty
        detail_lookup.setdefault(key, item.detail)

    for key, qty in aggregated.items():
        detail_lookup_item = detail_lookup[key]
        existing_detail = key_map.get(key)
        if existing_detail is not None:
            current_qty = existing_detail.prod_qty or Decimal("0")
            existing_detail.prod_qty = _quantise(current_qty + qty)
            continue

        prod_date = key[2]
        new_detail = InvProductionDtl(
            so_no=entry.so_no,
            so_prod_name=detail_lookup_item.so_prod_name,
            so_part_no=detail_lookup_item.so_part_no,
            prod_date=prod_date,
            prod_qty=_quantise(qty),
        )
        entry.items.append(new_detail)
        key_map[key] = new_detail


@router.post("/validate", response_model=ProductionEntryValidationOut)
async def validate_production_entry(
    payload: ProductionEntryValidationPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> ProductionEntryValidationOut:
    voucher = _normalise_voucher(payload.so_voucher_no)
    if not voucher:
        return ProductionEntryValidationOut(valid=False, items=[])

    so_header = await session.scalar(
        select(InvSoHdr)
        .where(InvSoHdr.so_no == voucher)
        .where(InvSoHdr.so_status == "O")
    )
    if not so_header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

    so_details = await _load_sales_order_details(session, so_header.so_no)
    if not so_details:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sales order has no line items to validate.",
        )

    _, detail_by_line, detail_by_key, line_lookup = _enumerate_sales_order_details(so_details)

    production_totals_result = await session.execute(
        select(
            InvProductionDtl.so_prod_name,
            InvProductionDtl.so_part_no,
            func.sum(InvProductionDtl.prod_qty),
        )
        .where(InvProductionDtl.so_no == voucher)
        .group_by(InvProductionDtl.so_prod_name, InvProductionDtl.so_part_no)
    )
    production_totals: dict[tuple[str, str], Decimal] = {}
    for prod_name, part_no, total in production_totals_result:
        key = (
            _normalise_key_token(prod_name),
            _normalise_key_token(part_no),
        )
        production_totals[key] = Decimal(total or 0)

    evaluated_items: list[
        tuple[
            ProductionEntryValidationItemPayload,
            InvSoSubDtl | None,
            tuple[str, str] | None,
            int | None,
        ]
    ] = []
    line_new_totals: dict[int, Decimal] = {}
    line_previous_totals: dict[int, Decimal] = {}

    for item in payload.items:
        matched_detail: InvSoSubDtl | None = None
        detail_key: tuple[str, str] | None = None
        matched_line_no: int | None = None
        if item.line_no is not None:
            matched_detail = detail_by_line.get(item.line_no)
            if matched_detail is not None:
                matched_line_no = item.line_no
        if matched_detail is None and (item.description or item.part_no):
            desc_key = _normalise_key_token(item.description)
            part_key = _normalise_key_token(item.part_no)
            matched_detail = detail_by_key.get((desc_key, part_key))

        new_qty = Decimal(item.prod_qty)
        previous_qty = Decimal(item.previous_prod_qty or 0)
        if matched_detail is not None:
            detail_key = (
                _normalise_key_token(matched_detail.so_prod_name),
                _normalise_key_token(matched_detail.so_part_no),
            )
            if matched_line_no is None:
                matched_line_no = line_lookup.get(detail_key)
        evaluated_items.append((item, matched_detail, detail_key, matched_line_no))
        if matched_detail is None or matched_line_no is None:
            continue
        line_no = matched_line_no
        line_new_totals[line_no] = line_new_totals.get(line_no, Decimal("0")) + new_qty
        line_previous_totals[line_no] = line_previous_totals.get(line_no, Decimal("0")) + previous_qty

    result_items: list[ProductionEntryValidationItemOut] = []
    valid = True
    so_date = so_header.so_date

    for item, matched_detail, detail_key, matched_line_no in evaluated_items:
        error: str | None = None
        line_no = matched_line_no if matched_line_no is not None else item.line_no
        if matched_detail is None or matched_line_no is None:
            error = "Sales order line could not be identified for this item."
        else:
            part_no = (matched_detail.so_part_no or "").strip()
            if not part_no:
                error = "Sales order line is missing a part number and cannot be produced."
            else:
                so_qty = Decimal(matched_detail.so_qty or 0)
                lookup_key = detail_key or ("", "")
                existing_total = production_totals.get(lookup_key, Decimal("0"))
                aggregated_previous = line_previous_totals.get(matched_line_no, Decimal("0"))
                aggregated_new = line_new_totals.get(matched_line_no, Decimal("0"))
                adjusted_existing = existing_total - aggregated_previous
                if adjusted_existing < 0:
                    adjusted_existing = Decimal("0")
                if adjusted_existing + aggregated_new > so_qty:
                    so_qty_display = f"{_quantise(so_qty):.2f}"
                    error = f"Production Qty exceeds Sales Order Qty (SO Qty: {so_qty_display})"

        if (
            error is None
            and item.production_date is not None
            and so_date is not None
            and item.production_date < so_date
        ):
            error = (
                "Prod Date cannot be earlier than SO Date "
                f"(SO Date: {so_date.strftime('%d-%m-%Y')})"
            )

        if error:
            valid = False

        result_items.append(
            ProductionEntryValidationItemOut(
                line_no=line_no,
                description=item.description,
                part_no=item.part_no,
                error=error,
            )
        )

    response = ProductionEntryValidationOut(valid=valid, items=result_items)

    await log_audit(
        session,
        user.inv_user_code,
        "production_entry",
        voucher,
        "VALIDATE",
        details={"item_count": len(result_items), "valid": response.valid},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return response


@router.get("/check")
async def check_production_entry(
    request: Request,
    so_voucher_no: str,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    voucher = _normalise_voucher(so_voucher_no)
    if not voucher:
        return {"exists": False}

    stmt = select(func.count()).select_from(InvProductionHdr).where(InvProductionHdr.so_no == voucher)
    exists = (await session.execute(stmt)).scalar_one() > 0

    await log_audit(
        session,
        user.inv_user_code,
        "production_entry",
        voucher,
        "CHECK_EXISTS",
        details={"exists": exists},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return {"exists": exists}


@router.get("/{so_voucher_no}", response_model=ProductionEntryOut)
async def get_production_entry(
    so_voucher_no: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> ProductionEntryOut:
    voucher = _normalise_voucher(so_voucher_no)
    so_header = await session.scalar(
        select(InvSoHdr)
        .where(InvSoHdr.so_no == voucher)
        .where(InvSoHdr.so_status == "O")
    )
    if not so_header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

    so_details = await _load_sales_order_details(session, so_header.so_no)

    entry = await session.scalar(
        select(InvProductionHdr)
        .options(selectinload(InvProductionHdr.items))
        .where(InvProductionHdr.so_no == voucher)
    )

    response = _serialise_production_entry(so_header, so_details, entry)

    await log_audit(
        session,
        user.inv_user_code,
        "production_entry",
        so_header.so_no,
        "VIEW",
        details={"has_entry": response.has_entry, "item_count": len(response.items)},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return response


@router.post("", response_model=ProductionEntryOut, status_code=status.HTTP_201_CREATED)
async def create_production_entry(
    payload: ProductionEntryPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> ProductionEntryOut:
    voucher = _normalise_voucher(payload.so_voucher_no)
    idempotency_key = require_idempotency_key(request)

    async def _create_once() -> ProductionEntryOut:
        async with repeatable_read_transaction(session):
            claim = await claim_idempotency_key(
                session,
                idempotency_key=idempotency_key,
                resource="production_entry",
            )
            if (
                claim.state == IdempotencyClaimState.REPLAY
                and claim.record
                and claim.record.resource_id
            ):
                existing = await _load_production_entry_response(
                    session, claim.record.resource_id
                )
                if existing:
                    return existing
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Original request completed but production entry was not found.",
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
                .where(InvSoHdr.so_status == "O")
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not so_header:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

            so_details = await _load_sales_order_details(
                session, so_header.so_no, for_update=True
            )
            if not so_details:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sales order has no line items to produce.",
                )

            existing = await session.scalar(
                select(InvProductionHdr.so_no)
                .where(InvProductionHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Production entry already exists.",
                )

            prepared_items = _prepare_production_items(
                so_details, payload.items, payload.production_date
            )

            entry = InvProductionHdr(
                so_no=so_header.so_no,
                production_date=payload.production_date,
                created_by=user.inv_user_code,
            )
            session.add(entry)
            _apply_prepared_production_items(entry, prepared_items)
            await session.flush()
            await _sync_sales_order_production_totals(session, so_header.so_no)

            response = await _load_production_entry_response(session, so_header.so_no)
            if not response:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to load saved production entry.",
                )

            await log_audit(
                session,
                user.inv_user_code,
                "production_entry",
                so_header.so_no,
                "CREATE",
                details={"item_count": len(response.items)},
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


@router.put("/{so_voucher_no}", response_model=ProductionEntryOut)
async def update_production_entry(
    so_voucher_no: str,
    payload: ProductionEntryPayload,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> ProductionEntryOut:
    voucher = _normalise_voucher(so_voucher_no)

    async def _update_once() -> ProductionEntryOut:
        async with repeatable_read_transaction(session):
            so_header = await session.scalar(
                select(InvSoHdr)
                .where(InvSoHdr.so_no == voucher)
                .where(InvSoHdr.so_status == "O")
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not so_header:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales order not found.")

            so_details = await _load_sales_order_details(
                session, so_header.so_no, for_update=True
            )

            entry = await session.scalar(
                select(InvProductionHdr)
                .options(selectinload(InvProductionHdr.items))
                .where(InvProductionHdr.so_no == voucher)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not entry:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production entry not found.")

            _ensure_expected_timestamp(entry.updated_at, payload.expected_updated_at)

            payload_voucher = _normalise_voucher(payload.so_voucher_no)
            if payload_voucher and payload_voucher != so_header.so_no:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sales order / voucher number cannot be changed.",
                )

            existing_totals = await _fetch_existing_production_totals(session, so_header.so_no)
            prepared_items = _prepare_production_items(
                so_details,
                payload.items,
                payload.production_date,
                existing_totals,
            )

            entry.production_date = payload.production_date
            entry.updated_by = user.inv_user_code
            entry.updated_at = datetime.now()
            _apply_prepared_production_items(entry, prepared_items)

            await session.flush()
            await _sync_sales_order_production_totals(session, so_header.so_no)

            so_details = await _load_sales_order_details(session, so_header.so_no)

            fresh_entry = await session.scalar(
                select(InvProductionHdr)
                .options(selectinload(InvProductionHdr.items))
                .where(InvProductionHdr.so_no == voucher)
            )
            if not fresh_entry:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to load saved production entry.",
                )

            response = _serialise_production_entry(so_header, so_details, fresh_entry)

            await log_audit(
                session,
                user.inv_user_code,
                "production_entry",
                so_header.so_no,
                "UPDATE",
                details={"item_count": len(response.items)},
                remote_addr=(request.client.host if request.client else None),
            )

            return response

    try:
        return await with_db_retry(session, _update_once)
    except OperationalError as exc:
        raise_on_lock_conflict(exc)

