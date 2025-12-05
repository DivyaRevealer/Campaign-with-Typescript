"""Pydantic models for campaign filter options."""

from typing import Dict, List, Any
from pydantic import BaseModel


class CampaignOptionsOut(BaseModel):
    """Schema for campaign filter options."""
    
    r_scores: List[int] = []
    f_scores: List[int] = []
    m_scores: List[int] = []
    rfm_segments: List[str] = []
    
    branches: List[str] = []
    branch_city_map: Dict[str, List[str]] = {}
    branch_state_map: Dict[str, List[str]] = {}
    
    brands: List[str] = []
    sections: List[str] = []
    products: List[str] = []
    models: List[str] = []
    items: List[str] = []
    brand_hierarchy: List[Dict[str, Any]] = []

