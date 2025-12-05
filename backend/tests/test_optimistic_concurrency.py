from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.core.optimistic_lock import _ensure_expected_timestamp
from app.schemas.delivery import DeliveryEntryItemPayload, DeliveryEntryPayload
from app.schemas.production import ProductionEntryItemPayload, ProductionEntryPayload
from app.schemas.salesorder import (
    SalesOrderHeaderPayload,
    SalesOrderItemPayload,
    SalesOrderPayload,
)


@pytest.mark.anyio
async def test_sales_order_stale_timestamp_raises_conflict():
    current = datetime.utcnow().replace(microsecond=0)
    payload = SalesOrderPayload(
        header=SalesOrderHeaderPayload(
            so_voucher_no="SO-TEST-001",
            so_voucher_date=date.today(),
            job_ref_no="JOB1",
            order_date=date.today(),
            client_po_no="PO123",
            company_code="COMP",
            company_name="Company",
            client_code="CLIENT",
            client_name="Client Name",
            currency="USD",
        ),
        items=[
            SalesOrderItemPayload(
                line_no=1,
                description="Widget",
                part_no="P001",
                due_on=date.today(),
                qty=Decimal("1"),
                rate=Decimal("10"),
                per="EA",
                disc_pct=Decimal("0"),
                amount=Decimal("10"),
            )
        ],
        expected_updated_at=current,
    )

    _ensure_expected_timestamp(current, payload.expected_updated_at)

    with pytest.raises(HTTPException) as excinfo:
        _ensure_expected_timestamp(
            current + timedelta(seconds=5), payload.expected_updated_at
        )

    assert excinfo.value.status_code == 409
    assert "updated" in excinfo.value.detail.lower()


@pytest.mark.anyio
async def test_production_entry_stale_timestamp_raises_conflict():
    current = datetime.utcnow().replace(microsecond=0)
    payload = ProductionEntryPayload(
        so_voucher_no="SO-TEST-002",
        production_date=date.today(),
        items=[
            ProductionEntryItemPayload(
                line_no=1,
                prod_qty=Decimal("1.00"),
                production_date=date.today(),
            )
        ],
        expected_updated_at=current,
    )

    _ensure_expected_timestamp(current, payload.expected_updated_at)

    with pytest.raises(HTTPException) as excinfo:
        _ensure_expected_timestamp(
            current + timedelta(seconds=5), payload.expected_updated_at
        )

    assert excinfo.value.status_code == 409
    assert "updated" in excinfo.value.detail.lower()


@pytest.mark.anyio
async def test_delivery_entry_stale_timestamp_raises_conflict():
    current = datetime.utcnow().replace(microsecond=0)
    payload = DeliveryEntryPayload(
        so_voucher_no="SO-TEST-003",
        dely_date=date.today(),
        items=[
            DeliveryEntryItemPayload(
                line_no=1,
                dely_qty=Decimal("1.00"),
                dely_date=date.today(),
            )
        ],
        expected_updated_at=current,
    )

    _ensure_expected_timestamp(current, payload.expected_updated_at)

    with pytest.raises(HTTPException) as excinfo:
        _ensure_expected_timestamp(
            current + timedelta(seconds=5), payload.expected_updated_at
        )

    assert excinfo.value.status_code == 409
    assert "updated" in excinfo.value.detail.lower()
