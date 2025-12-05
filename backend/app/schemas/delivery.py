"""Pydantic schemas for delivery entry operations."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, condecimal, field_validator


class DeliveryEntryItemPayload(BaseModel):
    line_no: int = Field(gt=0)
    dely_qty: condecimal(max_digits=18, decimal_places=2, gt=0)
    dely_date: date | None = None


class DeliveryEntryPayload(BaseModel):
    so_voucher_no: str = Field(min_length=1)
    dely_date: date
    items: List[DeliveryEntryItemPayload]
    expected_updated_at: Optional[datetime] = Field(
        default=None,
        description="Client-side timestamp of the version being updated. Used for optimistic concurrency control.",
    )

    @field_validator("so_voucher_no")
    @classmethod
    def _strip_voucher(cls, value: str) -> str:
        return value.strip()


class DeliveryEntryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_no: int
    description: str
    part_no: Optional[str] = None
    due_on: Optional[date]
    so_qty: Decimal
    dely_qty: Decimal
    stock_qty: Decimal


class DeliveryEntryHeaderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    so_voucher_no: str
    so_voucher_date: date
    company_code: str
    company_name: str
    client_code: str
    client_name: str
    dely_date: Optional[date] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class DeliveryEntryOut(BaseModel):
    header: DeliveryEntryHeaderOut
    items: List[DeliveryEntryItemOut]
    has_entry: bool


class DeliveryEntryValidationItemPayload(BaseModel):
    line_no: Optional[int] = None
    description: Optional[str] = None
    part_no: Optional[str] = None
    dely_qty: condecimal(max_digits=18, decimal_places=2, gt=0)
    dely_date: Optional[date] = None
    previous_dely_qty: condecimal(max_digits=18, decimal_places=2, ge=0) = Field(default=0)


class DeliveryEntryValidationPayload(BaseModel):
    so_voucher_no: str = Field(min_length=1)
    items: List[DeliveryEntryValidationItemPayload]

    @field_validator("so_voucher_no")
    @classmethod
    def _strip_validation_voucher(cls, value: str) -> str:
        return value.strip()


class DeliveryEntryValidationItemOut(BaseModel):
    line_no: Optional[int] = None
    description: Optional[str] = None
    part_no: Optional[str] = None
    error: Optional[str] = None


class DeliveryEntryValidationOut(BaseModel):
    valid: bool
    items: List[DeliveryEntryValidationItemOut]