"""Pydantic models for filter master data (dimension tables)."""

from typing import List
from pydantic import BaseModel, Field


class StateOption(BaseModel):
    """State option from dimension table."""

    id: int = Field(description="State ID")
    code: str = Field(description="State code")
    name: str = Field(description="State name")


class CityOption(BaseModel):
    """City option from dimension table with state relationship."""

    id: int = Field(description="City ID")
    code: str = Field(description="City code")
    name: str = Field(description="City name")
    state_id: int = Field(description="Parent state ID")
    state_name: str = Field(description="Parent state name")


class StoreOption(BaseModel):
    """Store option from dimension table with city and state relationships."""

    id: int = Field(description="Store ID")
    code: str = Field(description="Store code")
    name: str = Field(description="Store name")
    city_id: int = Field(description="Parent city ID")
    city_name: str = Field(description="Parent city name")
    state_id: int = Field(description="Parent state ID")
    state_name: str = Field(description="Parent state name")


class FilterMasterData(BaseModel):
    """Complete filter master data loaded once on page load."""

    states: List[StateOption] = Field(default_factory=list, description="All available states")
    cities: List[CityOption] = Field(default_factory=list, description="All available cities with state mapping")
    stores: List[StoreOption] = Field(default_factory=list, description="All available stores with city/state mapping")

