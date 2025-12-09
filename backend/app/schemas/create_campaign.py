"""Pydantic models for create campaign endpoints."""

from datetime import date, datetime
from typing import Optional, Dict, Any, List, Union

from pydantic import BaseModel, Field, field_validator, field_serializer


def _normalize_json_to_string(value: Any) -> Optional[str]:
    """Convert JSON/dict fields to string if needed."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        # If it's a dict, try to extract the string value
        # Common patterns: {"op": "="}, {"value": "="}, or just the first string value
        if "op" in value:
            return str(value["op"])
        if "value" in value:
            return str(value["value"])
        # Get first string value if any
        for v in value.values():
            if isinstance(v, str):
                return v
    return None


class CreateCampaignBase(BaseModel):
    """Base create campaign schema with common fields."""

    name: str = Field(..., description="Campaign name", min_length=1, max_length=255)
    start_date: date = Field(..., description="Campaign start date")
    end_date: date = Field(..., description="Campaign end date")
    based_on: str = Field(..., description="Campaign basis (e.g., 'RFM', 'Segment', etc.)", max_length=100)
    
    # RFM Mode fields
    rfm_mode: Optional[str] = Field(None, description="RFM mode", max_length=45)
    recency_op: Optional[str] = Field(None, description="Recency operation (=, >=, <=, between)")
    recency_min: Optional[int] = Field(None, description="Minimum recency value")
    recency_max: Optional[int] = Field(None, description="Maximum recency value")
    
    frequency_op: Optional[str] = Field(None, description="Frequency operation (=, >=, <=, between)")
    frequency_min: Optional[int] = Field(None, description="Minimum frequency value")
    frequency_max: Optional[int] = Field(None, description="Maximum frequency value")
    
    monetary_op: Optional[str] = Field(None, description="Monetary operation (=, >=, <=, between)")
    monetary_min: Optional[float] = Field(None, description="Minimum monetary value")
    monetary_max: Optional[float] = Field(None, description="Maximum monetary value")
    
    @field_validator("recency_op", "frequency_op", "monetary_op", mode="before")
    @classmethod
    def normalize_operation_field(cls, v: Any) -> Optional[str]:
        """Convert JSON/dict operation fields to string."""
        return _normalize_json_to_string(v)
    
    r_score: Optional[Union[List[int], Dict[str, Any]]] = Field(None, description="R score filter (list of scores)")
    f_score: Optional[Union[List[int], Dict[str, Any]]] = Field(None, description="F score filter (list of scores)")
    m_score: Optional[Union[List[int], Dict[str, Any]]] = Field(None, description="M score filter (list of scores)")
    rfm_segments: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="RFM segment filter (list of segments)")
    
    # Geography filters
    branch: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Branch filter (list of branches)")
    city: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="City filter (list of cities)")
    state: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="State filter (list of states)")
    
    # Date-based filters
    birthday_start: Optional[date] = Field(None, description="Birthday start date")
    birthday_end: Optional[date] = Field(None, description="Birthday end date")
    anniversary_start: Optional[date] = Field(None, description="Anniversary start date")
    anniversary_end: Optional[date] = Field(None, description="Anniversary end date")
    
    # Purchase filters
    purchase_type: Optional[str] = Field(None, description="Purchase type filter (any, recent)", max_length=100)
    purchase_brand: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Brand filter (list of brands)")
    section: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Section filter (list of sections)")
    product: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Product filter (list of products)")
    model: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Model filter (list of models)")
    item: Optional[Union[List[str], Dict[str, Any]]] = Field(None, description="Item filter (list of items)")
    value_threshold: Optional[float] = Field(None, description="Value threshold")


class CreateCampaignCreate(CreateCampaignBase):
    """Schema for creating a new campaign."""

    pass


class CreateCampaignUpdate(CreateCampaignBase):
    """Schema for updating an existing campaign."""

    expected_updated_at: Optional[datetime] = Field(
        None, description="Expected updated_at timestamp for optimistic locking"
    )


class CreateCampaignOut(CreateCampaignBase):
    """Schema for create campaign response."""

    id: int = Field(..., description="Campaign ID")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True

