"""Pydantic models for delivery report endpoints."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class DeliveryReportItemOut(BaseModel):
    """Serialised representation of a delivery detail row."""

    description: str = Field(description="Description of goods")
    part_no: Optional[str] = Field(default=None, description="Part number if available")
    dely_date: Optional[date] = Field(default=None, description="Delivery date")
    dely_qty: str = Field(description="Delivered quantity as a formatted string")


class DeliveryReportOut(BaseModel):
    """Payload returned for a delivery report lookup."""

    so_no: str = Field(description="Sales order number")
    items: List[DeliveryReportItemOut] = Field(
        default_factory=list,
        description="Delivery rows that match the sales order",
    )