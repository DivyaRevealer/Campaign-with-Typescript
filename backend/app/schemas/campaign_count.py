"""Pydantic models for campaign customer counting."""

from typing import Optional, Dict, Any, List
from datetime import date
from pydantic import BaseModel


class CampaignCountRequest(BaseModel):
    """Request schema for counting customers matching campaign criteria."""
    
    name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    based_on: Optional[str] = None
    
    # RFM Customized
    recency_op: Optional[str] = None
    recency_min: Optional[int] = None
    recency_max: Optional[int] = None
    frequency_op: Optional[str] = None
    frequency_min: Optional[int] = None
    frequency_max: Optional[int] = None
    monetary_op: Optional[str] = None
    monetary_min: Optional[float] = None
    monetary_max: Optional[float] = None
    
    # RFM Scores
    r_score: Optional[List[int]] = None
    f_score: Optional[List[int]] = None
    m_score: Optional[List[int]] = None
    rfm_segments: Optional[List[str]] = None
    
    # Geography
    branch: Optional[List[str]] = None
    city: Optional[List[str]] = None
    state: Optional[List[str]] = None
    
    # Occasions
    birthday_start: Optional[date] = None
    birthday_end: Optional[date] = None
    anniversary_start: Optional[date] = None
    anniversary_end: Optional[date] = None
    
    # Purchase
    purchase_type: Optional[str] = None
    purchase_brand: Optional[List[str]] = None
    section: Optional[List[str]] = None
    product: Optional[List[str]] = None
    model: Optional[List[str]] = None
    item: Optional[List[str]] = None
    value_threshold: Optional[float] = None
    
    # RFM Mode
    rfm_mode: Optional[str] = None


class CampaignCountResponse(BaseModel):
    """Response schema for customer count."""
    
    total_customers: int
    shortlisted_customers: int

