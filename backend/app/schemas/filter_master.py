"""Pydantic models for filter master data (dimension table)."""

from typing import List
from pydantic import BaseModel, Field


class FilterMasterData(BaseModel):
    """Complete filter master data loaded once on page load from dim_store_location."""

    states: List[str] = Field(default_factory=list, description="All unique states")
    cities: List[str] = Field(default_factory=list, description="All unique cities")
    stores: List[str] = Field(default_factory=list, description="All unique stores")
    # Mapping data for cascading
    store_to_city_state: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description="Map store_name -> {city, state}"
    )
    city_to_states: dict[str, List[str]] = Field(
        default_factory=dict,
        description="Map city -> list of states"
    )
    state_to_cities: dict[str, List[str]] = Field(
        default_factory=dict,
        description="Map state -> list of cities"
    )
    state_to_stores: dict[str, List[str]] = Field(
        default_factory=dict,
        description="Map state -> list of stores"
    )
    city_to_stores: dict[str, List[str]] = Field(
        default_factory=dict,
        description="Map city -> list of stores"
    )
