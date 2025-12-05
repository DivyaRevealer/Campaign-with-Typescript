"""Pydantic models for summary report endpoints."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class SummaryReportItemOut(BaseModel):
    """Serialised representation of a summary report row."""

    description: str = Field(description="Description of goods")
    part_no: Optional[str] = Field(default=None, description="Part number if available")
    ordered_qty: str = Field(description="Ordered quantity as a formatted string")
    delivered_qty: str = Field(description="Delivered quantity as a formatted string")
    yet_to_deliver_qty: str = Field(description="Remaining delivery quantity as a formatted string")
    stock_in_hand_qty: str = Field(description="Stock in hand quantity as a formatted string")
    yet_to_produce_qty: str = Field(description="Remaining production quantity as a formatted string")


class SummaryReportOut(BaseModel):
    """Payload returned for a summary report lookup."""

    so_no: str = Field(description="Sales order number")
    items: List[SummaryReportItemOut] = Field(
        default_factory=list,
        description="Summary rows that match the sales order",
    )