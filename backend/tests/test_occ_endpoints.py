"""Endpoint-level optimistic concurrency tests for key entities."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import FastAPI, HTTPException, status
import pytest

from httpx import AsyncClient

from app.core.optimistic_lock import _ensure_expected_timestamp
from app.schemas.delivery import DeliveryEntryOut, DeliveryEntryPayload
from app.schemas.production import ProductionEntryOut, ProductionEntryPayload
from app.schemas.salesorder import SalesOrderOut, SalesOrderPayload


def _build_sales_order_payload_dict(job_ref: str, *, expected_updated_at: str | None = None) -> dict:
    today = date.today().isoformat()
    return {
        "header": {
            "so_voucher_no": "SO-001",
            "so_voucher_date": today,
            "job_ref_no": job_ref,
            "order_date": today,
            "client_po_no": "PO-001",
            "company_code": "COMP",
            "company_name": "Example Company",
            "client_code": "CLIENT",
            "client_name": "Important Client",
            "currency": "USD",
        },
        "items": [
            {
                "line_no": 1,
                "description": "Test Item",
                "part_no": "PART-1",
                "due_on": today,
                "qty": "10",
                "rate": "5",
                "per": "NOS",
                "disc_pct": "0",
                "amount": "50",
            }
        ],
        "expected_updated_at": expected_updated_at,
    }


def _build_production_payload_dict(expected_updated_at: str | None = None) -> dict:
    today = date.today().isoformat()
    return {
        "so_voucher_no": "SO-001",
        "production_date": today,
        "items": [
            {
                "line_no": 1,
                "prod_qty": "3.5",
                "production_date": today,
            }
        ],
        "expected_updated_at": expected_updated_at,
    }


def _build_delivery_payload_dict(expected_updated_at: str | None = None) -> dict:
    today = date.today().isoformat()
    return {
        "so_voucher_no": "SO-001",
        "dely_date": today,
        "items": [
            {
                "line_no": 1,
                "dely_qty": "2.25",
                "dely_date": today,
            }
        ],
        "expected_updated_at": expected_updated_at,
    }


def _serialise_sales_order(record: dict) -> SalesOrderOut:
    items = []
    for idx, item in enumerate(record["items"], start=1):
        raw = item if isinstance(item, dict) else item.model_dump()
        amount = Decimal(raw["amount"])
        qty = Decimal(raw["qty"])
        items.append(
            {
                "line_no": raw.get("line_no") or idx,
                "description": raw["description"],
                "part_no": raw["part_no"],
                "due_on": date.fromisoformat(raw["due_on"]),
                "qty": float(qty),
                "rate": float(Decimal(raw["rate"])),
                "per": raw["per"],
                "disc_pct": float(Decimal(raw.get("disc_pct", "0"))),
                "amount": float(amount),
                "prod_qty": 0.0,
                "dely_qty": 0.0,
                "stock_qty": 0.0,
            }
        )

    header = dict(record["header"])
    header.setdefault("so_status", "O")
    header.setdefault("created_by", "tester")
    header.setdefault("updated_by", "tester")

    return SalesOrderOut(header=header, items=items)


def _serialise_production_entry(record: dict) -> ProductionEntryOut:
    return ProductionEntryOut(
        header=record["header"],
        items=record["items"],
        has_entry=True,
    )


def _serialise_delivery_entry(record: dict) -> DeliveryEntryOut:
    return DeliveryEntryOut(
        header=record["header"],
        items=record["items"],
        has_entry=True,
    )


def _build_occ_test_app() -> FastAPI:
    app = FastAPI()
    state: dict[str, dict] = {
        "sales_orders": {},
        "production_entries": {},
        "delivery_entries": {},
    }

    @app.post("/sales-orders", response_model=SalesOrderOut, status_code=status.HTTP_201_CREATED)
    async def create_sales_order(payload: SalesOrderPayload):
        now = datetime.utcnow()
        header = payload.header.model_dump()
        header.update(
            {
                "so_status": "O",
                "created_at": now,
                "updated_at": now,
                "created_by": "tester",
                "updated_by": "tester",
            }
        )
        record = {"header": header, "items": [item.model_dump(mode="json") for item in payload.items]}
        state["sales_orders"][header["so_voucher_no"]] = record
        return _serialise_sales_order(record)

    @app.get("/sales-orders/{so_voucher_no}", response_model=SalesOrderOut)
    async def get_sales_order(so_voucher_no: str):
        record = state["sales_orders"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        return _serialise_sales_order(record)

    @app.put("/sales-orders/{so_voucher_no}", response_model=SalesOrderOut)
    async def update_sales_order(so_voucher_no: str, payload: SalesOrderPayload):
        record = state["sales_orders"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        _ensure_expected_timestamp(record["header"].get("updated_at"), payload.expected_updated_at)
        record["header"].update(payload.header.model_dump())
        record["header"]["updated_at"] = datetime.utcnow() + timedelta(seconds=1)
        return _serialise_sales_order(record)

    @app.post(
        "/production-entries",
        response_model=ProductionEntryOut,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_production_entry(payload: ProductionEntryPayload):
        now = datetime.utcnow()
        header = {
            "so_voucher_no": payload.so_voucher_no,
            "so_voucher_date": date.today(),
            "company_code": "COMP",
            "company_name": "Example Company",
            "client_code": "CLIENT",
            "client_name": "Important Client",
            "production_date": payload.production_date,
            "created_by": "tester",
            "created_at": now,
            "updated_by": "tester",
            "updated_at": now,
        }

        items = []
        for item in payload.items:
            so_qty = Decimal("10.00")
            prod_qty = Decimal(item.prod_qty)
            items.append(
                {
                    "line_no": item.line_no,
                    "description": "Prod Item",
                    "part_no": "PROD-PART",
                    "due_on": None,
                    "so_qty": float(so_qty),
                    "prod_qty": float(prod_qty),
                    "bal_qty": float(so_qty - prod_qty),
                }
            )

        record = {"header": header, "items": items}
        state["production_entries"][payload.so_voucher_no] = record
        return _serialise_production_entry(record)

    @app.get("/production-entries/{so_voucher_no}", response_model=ProductionEntryOut)
    async def get_production_entry(so_voucher_no: str):
        record = state["production_entries"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        return _serialise_production_entry(record)

    @app.put("/production-entries/{so_voucher_no}", response_model=ProductionEntryOut)
    async def update_production_entry(so_voucher_no: str, payload: ProductionEntryPayload):
        record = state["production_entries"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        _ensure_expected_timestamp(record["header"].get("updated_at"), payload.expected_updated_at)
        record["header"]["production_date"] = payload.production_date
        record["header"]["updated_at"] = datetime.utcnow() + timedelta(seconds=1)
        return _serialise_production_entry(record)

    @app.post(
        "/delivery-entries",
        response_model=DeliveryEntryOut,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_delivery_entry(payload: DeliveryEntryPayload):
        now = datetime.utcnow()
        header = {
            "so_voucher_no": payload.so_voucher_no,
            "so_voucher_date": date.today(),
            "company_code": "COMP",
            "company_name": "Example Company",
            "client_code": "CLIENT",
            "client_name": "Important Client",
            "dely_date": payload.dely_date,
            "created_by": "tester",
            "created_at": now,
            "updated_by": "tester",
            "updated_at": now,
        }

        items = []
        for item in payload.items:
            stock_qty = Decimal("5.0")
            dely_qty = Decimal(item.dely_qty)
            items.append(
                {
                    "line_no": item.line_no,
                    "description": "Dely Item",
                    "part_no": "DELY-PART",
                    "due_on": None,
                    "so_qty": float(Decimal("5.0")),
                    "dely_qty": float(dely_qty),
                    "stock_qty": float(stock_qty),
                }
            )

        record = {"header": header, "items": items}
        state["delivery_entries"][payload.so_voucher_no] = record
        return _serialise_delivery_entry(record)

    @app.get("/delivery-entries/{so_voucher_no}", response_model=DeliveryEntryOut)
    async def get_delivery_entry(so_voucher_no: str):
        record = state["delivery_entries"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        return _serialise_delivery_entry(record)

    @app.put("/delivery-entries/{so_voucher_no}", response_model=DeliveryEntryOut)
    async def update_delivery_entry(so_voucher_no: str, payload: DeliveryEntryPayload):
        record = state["delivery_entries"].get(so_voucher_no)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        _ensure_expected_timestamp(record["header"].get("updated_at"), payload.expected_updated_at)
        record["header"]["dely_date"] = payload.dely_date
        record["header"]["updated_at"] = datetime.utcnow() + timedelta(seconds=1)
        return _serialise_delivery_entry(record)

    return app


@pytest.mark.anyio
async def test_sales_order_optimistic_concurrency_flow():
    app = _build_occ_test_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        create_payload = _build_sales_order_payload_dict("JOB-1")
        create_response = await client.post("/sales-orders", json=create_payload)
        assert create_response.status_code == status.HTTP_201_CREATED

        initial = await client.get("/sales-orders/SO-001")
        assert initial.status_code == status.HTTP_200_OK
        initial_updated_at = initial.json()["header"]["updated_at"]

        first_update_payload = _build_sales_order_payload_dict(
            "JOB-UPDATED", expected_updated_at=initial_updated_at
        )
        first_update = await client.put("/sales-orders/SO-001", json=first_update_payload)
        assert first_update.status_code == status.HTTP_200_OK
        first_body = first_update.json()
        assert first_body["header"]["job_ref_no"] == "JOB-UPDATED"

        conflict_payload = _build_sales_order_payload_dict(
            "JOB-CONFLICT", expected_updated_at=initial_updated_at
        )
        conflict = await client.put("/sales-orders/SO-001", json=conflict_payload)
        assert conflict.status_code == status.HTTP_409_CONFLICT
        assert "updated" in conflict.json()["detail"].lower()

        current = await client.get("/sales-orders/SO-001")
        assert current.json()["header"]["job_ref_no"] == "JOB-UPDATED"


@pytest.mark.anyio
async def test_production_entry_optimistic_concurrency_flow():
    app = _build_occ_test_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        await client.post("/sales-orders", json=_build_sales_order_payload_dict("JOB-1"))

        created = await client.post("/production-entries", json=_build_production_payload_dict())
        assert created.status_code == status.HTTP_201_CREATED

        entry = await client.get("/production-entries/SO-001")
        assert entry.status_code == status.HTTP_200_OK
        initial_updated_at = entry.json()["header"]["updated_at"]

        first_update = await client.put(
            "/production-entries/SO-001",
            json=_build_production_payload_dict(expected_updated_at=initial_updated_at),
        )
        assert first_update.status_code == status.HTTP_200_OK

        conflict = await client.put(
            "/production-entries/SO-001",
            json=_build_production_payload_dict(expected_updated_at=initial_updated_at),
        )
        assert conflict.status_code == status.HTTP_409_CONFLICT
        assert "updated" in conflict.json()["detail"].lower()


@pytest.mark.anyio
async def test_delivery_entry_optimistic_concurrency_flow():
    app = _build_occ_test_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        await client.post("/sales-orders", json=_build_sales_order_payload_dict("JOB-1"))

        created = await client.post("/delivery-entries", json=_build_delivery_payload_dict())
        assert created.status_code == status.HTTP_201_CREATED

        entry = await client.get("/delivery-entries/SO-001")
        assert entry.status_code == status.HTTP_200_OK
        initial_updated_at = entry.json()["header"]["updated_at"]

        first_update = await client.put(
            "/delivery-entries/SO-001",
            json=_build_delivery_payload_dict(expected_updated_at=initial_updated_at),
        )
        assert first_update.status_code == status.HTTP_200_OK

        conflict = await client.put(
            "/delivery-entries/SO-001",
            json=_build_delivery_payload_dict(expected_updated_at=initial_updated_at),
        )
        assert conflict.status_code == status.HTTP_409_CONFLICT
        assert "updated" in conflict.json()["detail"].lower()

