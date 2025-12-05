"""Pydantic schemas for Sales Order operations."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class SalesOrderItemPayload(BaseModel):
    """Represents a single sales order line item in payloads."""

    line_no: Optional[int] = Field(default=None, ge=1)
    description: str = Field(..., min_length=1, max_length=1000)
    part_no: str = Field(..., min_length=1, max_length=255)
    due_on: date
    qty: Decimal = Field(..., gt=Decimal("0"))
    rate: Decimal = Field(..., gt=Decimal("0"))
    per: str = Field(..., min_length=1, max_length=50)
    disc_pct: Decimal = Field(default=Decimal("0"), ge=Decimal("0"), le=Decimal("100"))
    amount: Decimal = Field(..., gt=Decimal("0"))

    @field_validator("description", mode="before")
    @classmethod
    def _strip_description(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("part_no", mode="before")
    @classmethod
    def _strip_part_no(cls, value: Optional[str]) -> str:
        if value is None:
            raise ValueError("Part number is required")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Part number is required")
        return trimmed

    @field_validator("per", mode="before")
    @classmethod
    def _normalise_per(cls, value: Optional[str]) -> str:
        if value is None:
            raise ValueError("Unit of measure is required")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Unit of measure is required")
        return trimmed.upper()


class SalesOrderHeaderPayload(BaseModel):
    """Represents the header section for a sales order payload."""

    so_voucher_no: Optional[str] = Field(default=None, max_length=100)
    so_voucher_date: date
    job_ref_no: Optional[str] = Field(default=None, max_length=100)
    order_date: Optional[date] = None
    client_po_no: str = Field(..., min_length=1, max_length=100)
    company_code: str = Field(..., min_length=1, max_length=100)
    company_name: str = Field(..., min_length=1, max_length=255)
    client_code: str = Field(..., min_length=1, max_length=100)
    client_name: str = Field(..., min_length=1, max_length=255)
    currency: str = Field(..., min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")

    @field_validator("client_po_no", "company_code", "company_name", "client_code", "client_name", "currency", mode="before")
    @classmethod
    def _strip_required_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            raise ValueError("Field is required")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Field is required")
        return trimmed

    @field_validator("so_voucher_no", "job_ref_no", mode="before")
    @classmethod
    def _strip_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("currency", mode="before")
    @classmethod
    def _uppercase_currency(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        trimmed = value.strip().upper()
        if not trimmed:
            raise ValueError("Currency is required")
        return trimmed


class SalesOrderPayload(BaseModel):
    """Top-level payload for creating or updating a sales order."""

    header: SalesOrderHeaderPayload
    items: List[SalesOrderItemPayload]
    expected_updated_at: Optional[datetime] = Field(
        default=None,
        description="Client-side timestamp of the version being updated. Used for optimistic concurrency control.",
    )


class SalesOrderItemOut(BaseModel):
    """Sales order line item returned from the API."""

    line_no: int
    description: str
    part_no: str
    due_on: date
    qty: float
    rate: float
    per: str
    disc_pct: float = Field(default=0.0)
    amount: float
    prod_qty: float = Field(default=0.0)
    dely_qty: float = Field(default=0.0)
    stock_qty: float = Field(default=0.0)


class SalesOrderHeaderOut(BaseModel):
    """Sales order header information returned from the API."""

    so_voucher_no: str
    so_voucher_date: date
    order_date: Optional[date] = None
    job_ref_no: str
    client_po_no: str
    company_code: str
    company_name: str
    client_code: str
    client_name: str
    currency: str
    so_status: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class SalesOrderOut(BaseModel):
    """Full sales order representation returned to clients."""

    header: SalesOrderHeaderOut
    items: List[SalesOrderItemOut]


class SalesOrderCancelOut(BaseModel):
    """Response returned when a sales order is cancelled."""

    so_voucher_no: str
    status: str
    message: Optional[str] = None


class SalesOrderCancelPayload(BaseModel):
    """Payload for cancelling a sales order with optimistic concurrency control."""

    expected_updated_at: Optional[datetime] = Field(
        default=None,
        description="Client-side timestamp of the version being updated. Used for optimistic concurrency control.",
    )


class SalesOrderUploadItemOut(BaseModel):
    """Represents a single line item obtained from an uploaded Excel sheet."""

    description: str = ""
    part_no: str | None = None
    due_on: str | None = None
    qty: str | None = None
    rate: str | None = None
    per: str | None = None
    disc_pct: str | None = None


class SalesOrderUploadOut(BaseModel):
    """Response schema for the Excel line-item upload endpoint."""

    file_name: str
    sheet_name: str
    items: list[SalesOrderUploadItemOut]