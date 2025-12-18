"""Pydantic models for campaign dashboard endpoints."""

from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class CampaignKPIData(BaseModel):
    """KPI metrics for the campaign dashboard."""

    total_customer: float = Field(description="Total number of customers")
    unit_per_transaction: float = Field(description="Average units per transaction")
    customer_spending: float = Field(description="Total customer spending")
    days_to_return: float = Field(description="Average days to return")
    retention_rate: float = Field(description="Customer retention rate percentage")


class ChartDataPoint(BaseModel):
    """Data point for charts."""

    name: str = Field(description="Label/name for the data point")
    value: float = Field(description="Numeric value")
    count: Optional[float] = Field(default=None, description="Count if different from value")


class SegmentDataPoint(BaseModel):
    """Data point for customer segments."""

    name: str = Field(description="Segment name")
    value: float = Field(description="Number of customers in segment")
    fill: Optional[str] = Field(default=None, description="Color for visualization")


class DaysToReturnBucketData(BaseModel):
    """Data for days to return bucket chart."""

    name: str = Field(description="Bucket name (e.g., '1-2 Month')")
    count: float = Field(description="Number of customers in this bucket")


class FiscalYearData(BaseModel):
    """Data for fiscal year customer percentage chart."""

    year: str = Field(description="Fiscal year")
    new_customer_percent: float = Field(description="Percentage of new customers")
    old_customer_percent: float = Field(description="Percentage of old customers")


class CampaignDashboardFilters(BaseModel):
    """Filters for campaign dashboard query."""

    state: Optional[str] = Field(default=None, description="Filter by state")
    city: Optional[str] = Field(default=None, description="Filter by city")
    store: Optional[str] = Field(default=None, description="Filter by store name")
    segment_map: Optional[str] = Field(default=None, description="Filter by segment map")
    r_value_bucket: Optional[str] = Field(default=None, description="Filter by R value bucket")
    f_value_bucket: Optional[str] = Field(default=None, description="Filter by F value bucket")
    m_value_bucket: Optional[str] = Field(default=None, description="Filter by M value bucket")


class FilterOptions(BaseModel):
    """Available filter options for dropdowns."""

    states: List[str] = Field(default_factory=list, description="List of states")
    cities: List[str] = Field(default_factory=list, description="List of cities")
    stores: List[str] = Field(default_factory=list, description="List of store names")
    segment_maps: List[str] = Field(default_factory=list, description="List of segment maps")
    r_value_buckets: List[str] = Field(default_factory=list, description="List of R value buckets")
    f_value_buckets: List[str] = Field(default_factory=list, description="List of F value buckets")
    m_value_buckets: List[str] = Field(default_factory=list, description="List of M value buckets")


class CampaignDashboardOut(BaseModel):
    """Complete campaign dashboard response."""

    kpi: CampaignKPIData = Field(description="Key performance indicators")
    r_score_data: List[ChartDataPoint] = Field(
        default_factory=list, description="R score distribution data"
    )
    f_score_data: List[ChartDataPoint] = Field(
        default_factory=list, description="F score distribution data"
    )
    m_score_data: List[ChartDataPoint] = Field(
        default_factory=list, description="M score distribution data"
    )
    r_value_bucket_data: List[ChartDataPoint] = Field(
        default_factory=list, description="R value bucket distribution"
    )
    visits_data: List[ChartDataPoint] = Field(
        default_factory=list, description="Customer visits distribution"
    )
    value_data: List[ChartDataPoint] = Field(
        default_factory=list, description="Customer value distribution"
    )
    segment_data: List[SegmentDataPoint] = Field(
        default_factory=list, description="Customer segment distribution"
    )
    days_to_return_bucket_data: List[DaysToReturnBucketData] = Field(
        default_factory=list, description="Days to return bucket distribution"
    )
    fiscal_year_data: List[FiscalYearData] = Field(
        default_factory=list, description="Fiscal year customer percentage data"
    )
