"""Pydantic schemas for production entry operations."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict, condecimal, field_validator


class ProductionEntryItemPayload(BaseModel):
    line_no: int = Field(gt=0)
    prod_qty: condecimal(max_digits=18, decimal_places=2, gt=0)
    production_date: date


class ProductionEntryPayload(BaseModel):
    so_voucher_no: str = Field(min_length=1)
    production_date: date
    items: List[ProductionEntryItemPayload]
    expected_updated_at: Optional[datetime] = Field(
        default=None,
        description="Client-side timestamp of the version being updated. Used for optimistic concurrency control.",
    )

    @field_validator("so_voucher_no")
    @classmethod
    def _strip_voucher(cls, value: str) -> str:
        return value.strip()


class ProductionEntryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_no: int
    description: str
    part_no: Optional[str] = None
    due_on: Optional[date]
    so_qty: Decimal
    prod_qty: Decimal
    bal_qty: Decimal


class ProductionEntryHeaderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    so_voucher_no: str
    so_voucher_date: date
    company_code: str
    company_name: str
    client_code: str
    client_name: str
    production_date: Optional[date] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class ProductionEntryOut(BaseModel):
    header: ProductionEntryHeaderOut
    items: List[ProductionEntryItemOut]
    has_entry: bool

class ProductionEntryValidationItemPayload(BaseModel):
    line_no: Optional[int] = None
    description: Optional[str] = None
    part_no: Optional[str] = None
    prod_qty: condecimal(max_digits=18, decimal_places=2, gt=0)
    production_date: date
    previous_prod_qty: condecimal(max_digits=18, decimal_places=2, ge=0) = Field(default=0)


class ProductionEntryValidationPayload(BaseModel):
    so_voucher_no: str = Field(min_length=1)
    items: List[ProductionEntryValidationItemPayload]

    @field_validator("so_voucher_no")
    @classmethod
    def _strip_validation_voucher(cls, value: str) -> str:
        return value.strip()


class ProductionEntryValidationItemOut(BaseModel):
    line_no: Optional[int] = None
    description: Optional[str] = None
    part_no: Optional[str] = None
    error: Optional[str] = None


class ProductionEntryValidationOut(BaseModel):
    valid: bool
    items: List[ProductionEntryValidationItemOut]