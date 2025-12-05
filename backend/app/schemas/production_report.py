"""Pydantic models for production report endpoints."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class ProductionReportItemOut(BaseModel):
    """Serialised representation of a production detail row."""

    description: str = Field(description="Description of goods")
    part_no: Optional[str] = Field(default=None, description="Part number if available")
    prod_date: Optional[date] = Field(default=None, description="Production date")
    prod_qty: str = Field(description="Produced quantity as a formatted string")


class ProductionReportOut(BaseModel):
    """Payload returned for a production report lookup."""

    so_no: str = Field(description="Sales order number")
    items: List[ProductionReportItemOut] = Field(
        default_factory=list,
        description="Production rows that match the sales order",
    )