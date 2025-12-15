"""OPTIMIZED API endpoints for campaign dashboard with caching and parallel execution."""

import asyncio
import hashlib
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy import func, select, text, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.cache import get_cache, set_cache, generate_cache_key
from app.models.inv_crm_analysis import InvCrmAnalysis
from app.models.inv_user import InvUserMaster
from app.schemas.campaign_dashboard import (
    CampaignDashboardOut,
    CampaignKPIData,
    ChartDataPoint,
    SegmentDataPoint,
    DaysToReturnBucketData,
    FiscalYearData,
    FilterOptions,
)

router = APIRouter(prefix="/campaign", tags=["campaign-dashboard"])

# Cache TTL: 15 minutes (900 seconds)
CACHE_TTL = 900


def _apply_base_filters(query, filters: dict):
    """Apply common filters to a query. Optimized with indexed columns."""
    # Date filters - use indexed FIRST_IN_DATE
    start_date = filters.get("start_date")
    if start_date and start_date.strip():
        query = query.where(InvCrmAnalysis.first_in_date >= start_date)
    
    end_date = filters.get("end_date")
    if end_date and end_date.strip():
        query = query.where(InvCrmAnalysis.first_in_date <= end_date)
    
    # Customer filters - use indexed columns
    customer_mobile = filters.get("customer_mobile")
    if customer_mobile and customer_mobile != "All" and customer_mobile.strip():
        query = query.where(InvCrmAnalysis.cust_mobileno == customer_mobile)
    
    customer_name = filters.get("customer_name")
    if customer_name and customer_name != "All" and customer_name.strip():
        query = query.where(InvCrmAnalysis.customer_name == customer_name)
    
    # R value bucket filter - use indexed R_VALUE column
    r_value_bucket = filters.get("r_value_bucket")
    if r_value_bucket and r_value_bucket != "All":
        bucket = r_value_bucket
        if bucket == "1-200":
            query = query.where(InvCrmAnalysis.r_value <= 200)
        elif bucket == "200-400":
            query = query.where(and_(InvCrmAnalysis.r_value > 200, InvCrmAnalysis.r_value <= 400))
        elif bucket == "400-600":
            query = query.where(and_(InvCrmAnalysis.r_value > 400, InvCrmAnalysis.r_value <= 600))
        elif bucket == "600-800":
            query = query.where(and_(InvCrmAnalysis.r_value > 600, InvCrmAnalysis.r_value <= 800))
        elif bucket == "800-1000":
            query = query.where(and_(InvCrmAnalysis.r_value > 800, InvCrmAnalysis.r_value <= 1000))
        elif bucket == ">1000":
            query = query.where(InvCrmAnalysis.r_value > 1000)
    
    # F value bucket filter - use indexed F_VALUE
    f_value_bucket = filters.get("f_value_bucket")
    if f_value_bucket and f_value_bucket != "All":
        try:
            f_value = int(f_value_bucket)
            query = query.where(InvCrmAnalysis.f_value == f_value)
        except (ValueError, TypeError):
            pass
    
    # M value bucket filter - use indexed M_VALUE
    m_value_bucket = filters.get("m_value_bucket")
    if m_value_bucket and m_value_bucket != "All":
        bucket = m_value_bucket
        if bucket == "1-1000":
            query = query.where(InvCrmAnalysis.m_value <= 1000)
        elif bucket == "1000-2000":
            query = query.where(and_(InvCrmAnalysis.m_value > 1000, InvCrmAnalysis.m_value <= 2000))
        elif bucket == "2000-3000":
            query = query.where(and_(InvCrmAnalysis.m_value > 2000, InvCrmAnalysis.m_value <= 3000))
        elif bucket == "3000-4000":
            query = query.where(and_(InvCrmAnalysis.m_value > 3000, InvCrmAnalysis.m_value <= 4000))
        elif bucket == "4000-5000":
            query = query.where(and_(InvCrmAnalysis.m_value > 4000, InvCrmAnalysis.m_value <= 5000))
        elif bucket == ">5000":
            query = query.where(InvCrmAnalysis.m_value > 5000)
    
    return query


async def _get_kpi_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> CampaignKPIData:
    """Optimized KPI calculation using single query with multiple aggregations."""
    
    # Single query to get all KPI metrics at once (much faster than multiple queries)
    query = select(
        func.count(InvCrmAnalysis.cust_mobileno).label("total_customer"),
        func.avg(InvCrmAnalysis.no_of_items).label("unit_per_transaction"),
        func.avg(InvCrmAnalysis.total_sales).label("customer_spending"),
        func.avg(InvCrmAnalysis.days).label("days_to_return"),
        func.sum(case((InvCrmAnalysis.f_score > 1, 1), else_=0)).label("returning_customers"),
    )
    
    query = _apply_base_filters(query, filters)
    result = await session.execute(query)
    row = result.first()
    
    total_customer = float(row.total_customer or 0)
    returning_customers = float(row.returning_customers or 0)
    
    # Calculate retention rate
    retention_rate = (returning_customers / total_customer * 100) if total_customer > 0 else 0.0
    
    return CampaignKPIData(
        total_customer=total_customer,
        unit_per_transaction=float(row.unit_per_transaction or 0.0),
        profit_per_customer=0.0,  # Placeholder
        customer_spending=float(row.customer_spending or 0.0),
        days_to_return=float(row.days_to_return or 0.0),
        retention_rate=retention_rate,
    )


async def _get_r_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized R score distribution using indexed R_SCORE column."""
    
    query = select(
        case(
            (InvCrmAnalysis.r_score == 5, "Bought Most Recently"),
            else_="Other"
        ).label("category"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by("category")
    
    results = (await session.execute(query)).all()
    return [
        ChartDataPoint(name=r.category, value=float(r.count), count=float(r.count))
        for r in results
    ]


async def _get_f_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized F score distribution using indexed F_SCORE column."""
    
    query = select(
        InvCrmAnalysis.f_score,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.f_score).order_by(InvCrmAnalysis.f_score)
    
    results = (await session.execute(query)).all()
    
    score_labels = {
        1: "Most Rarest Visit",
        2: "2",
        3: "3",
        4: "4",
        5: "More Frequent Visit",
    }
    
    return [
        ChartDataPoint(
            name=score_labels.get(r.f_score, str(r.f_score)),
            value=float(r.count),
            count=float(r.count)
        )
        for r in results
    ]


async def _get_m_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized M score distribution using indexed M_SCORE column."""
    
    query = select(
        InvCrmAnalysis.m_score,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.m_score).order_by(InvCrmAnalysis.m_score)
    
    results = (await session.execute(query)).all()
    
    return [
        ChartDataPoint(
            name=f"Category {r.m_score}",
            value=float(r.count),
            count=float(r.count)
        )
        for r in results
    ]


async def _get_r_value_bucket_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized R value bucket using indexed R_VALUE column with SQL aggregation."""
    
    query = select(
        case(
            (InvCrmAnalysis.r_value <= 200, "1-200"),
            (InvCrmAnalysis.r_value <= 400, "200-400"),
            (InvCrmAnalysis.r_value <= 600, "400-600"),
            (InvCrmAnalysis.r_value <= 800, "600-800"),
            (InvCrmAnalysis.r_value <= 1000, "800-1000"),
            else_=">1000"
        ).label("bucket"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by("bucket")
    
    results = (await session.execute(query)).all()
    return [
        ChartDataPoint(name=r.bucket, value=float(r.count))
        for r in results
    ]


async def _get_visits_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized visits data using indexed F_VALUE column."""
    
    query = select(
        InvCrmAnalysis.f_value,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.f_value).order_by(InvCrmAnalysis.f_value)
    
    results = (await session.execute(query)).all()
    
    return [
        ChartDataPoint(name=str(r.f_value), value=float(r.count))
        for r in results
    ]


async def _get_value_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Optimized value data using indexed M_VALUE column with SQL aggregation."""
    
    query = select(
        case(
            (InvCrmAnalysis.m_value <= 1000, "1-1000"),
            (InvCrmAnalysis.m_value <= 2000, "1000-2000"),
            (InvCrmAnalysis.m_value <= 3000, "2000-3000"),
            (InvCrmAnalysis.m_value <= 4000, "3000-4000"),
            (InvCrmAnalysis.m_value <= 5000, "4000-5000"),
            else_=">5000"
        ).label("bucket"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by("bucket")
    
    results = (await session.execute(query)).all()
    
    return [
        ChartDataPoint(name=r.bucket, value=float(r.count))
        for r in results
    ]


async def _get_segment_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[SegmentDataPoint]:
    """Optimized segment data using indexed SEGMENT_MAP column."""
    
    query = select(
        InvCrmAnalysis.segment_map,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.segment_map)
    
    results = (await session.execute(query)).all()
    
    segment_colors = {
        "Champions": "#22c55e",
        "Potential Loyalists": "#7dd3fc",
        "New Customers": "#1e40af",
        "Need Attention": "#2dd4bf",
        "At Risk": "#f97316",
        "Lost": "#ef4444",
        "Hibernating": "#94a3b8",
    }
    
    # Create list with title case names
    segment_data = []
    for r in results:
        segment = r.segment_map or "Unknown"
        # Convert to title case for better display
        segment = segment.title() if segment else "Unknown"
        color = segment_colors.get(segment, "#8884d8")  # Default color
        segment_data.append(
            SegmentDataPoint(
                name=segment,
                value=float(r.count),
                fill=color
            )
        )
    
    return segment_data


async def _get_days_to_return_bucket_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[DaysToReturnBucketData]:
    """Optimized days to return bucket using SQL aggregation instead of Python processing."""
    
    # Use SQL CASE to bucket directly in database (much faster than fetching all rows)
    query = select(
        case(
            (InvCrmAnalysis.days <= 60, "1-2 Month"),
            (InvCrmAnalysis.days <= 180, "3-6 Month"),
            (InvCrmAnalysis.days <= 730, "1-2 Yr"),
            else_=">2 Yr"
        ).label("bucket"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by("bucket")
    
    results = (await session.execute(query)).all()
    
    # Ensure all buckets are present (even if count is 0)
    buckets = {
        "1-2 Month": 0,
        "3-6 Month": 0,
        "1-2 Yr": 0,
        ">2 Yr": 0,
    }
    
    for r in results:
        if r.bucket in buckets:
            buckets[r.bucket] = float(r.count)
    
    return [
        DaysToReturnBucketData(name=bucket, count=count)
        for bucket, count in buckets.items()
    ]


async def _get_fiscal_year_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[FiscalYearData]:
    """Optimized fiscal year data using SQL aggregation instead of Python processing."""
    
    # Aggregate year counts directly in SQL (much faster)
    query = select(
        func.sum(InvCrmAnalysis.fifth_yr_count).label("yr_2020"),
        func.sum(InvCrmAnalysis.fourth_yr_count).label("yr_2021"),
        func.sum(InvCrmAnalysis.third_yr_count).label("yr_2022"),
        func.sum(InvCrmAnalysis.second_yr_count).label("yr_2023"),
        func.sum(InvCrmAnalysis.first_yr_count).label("yr_2024"),
    )
    
    query = _apply_base_filters(query, filters)
    result = await session.execute(query)
    row = result.first()
    
    year_totals = {
        "2020": float(row.yr_2020 or 0),
        "2021": float(row.yr_2021 or 0),
        "2022": float(row.yr_2022 or 0),
        "2023": float(row.yr_2023 or 0),
        "2024": float(row.yr_2024 or 0),
    }
    
    # Calculate cumulative percentages
    cumulative_old = 0
    customer_percent_data = []
    
    for year in ["2020", "2021", "2022", "2023", "2024"]:
        new = year_totals[year]
        total = new + cumulative_old
        
        if total > 0:
            new_pct = round((new / total) * 100, 2)
            old_pct = round((cumulative_old / total) * 100, 2)
        else:
            new_pct = old_pct = 0.0
        
        customer_percent_data.append(
            FiscalYearData(
                year=year,
                new_customer_percent=new_pct,
                old_customer_percent=old_pct
            )
        )
        
        cumulative_old += new
    
    return customer_percent_data


@router.get("/dashboard", response_model=CampaignDashboardOut)
async def get_campaign_dashboard_optimized(
    request: Request,
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    customer_mobile: Optional[str] = Query(None, description="Filter by customer mobile"),
    customer_name: Optional[str] = Query(None, description="Filter by customer name"),
    r_value_bucket: Optional[str] = Query(None, description="Filter by R value bucket"),
    f_value_bucket: Optional[str] = Query(None, description="Filter by F value bucket"),
    m_value_bucket: Optional[str] = Query(None, description="Filter by M value bucket"),
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> CampaignDashboardOut:
    """
    OPTIMIZED: Get campaign dashboard data with caching and parallel execution.
    
    Performance improvements:
    - Redis caching (15 min TTL)
    - Parallel query execution (asyncio.gather)
    - Optimized SQL queries with indexes
    - Single query for KPI metrics
    - SQL aggregation instead of Python processing
    
    Expected response time: <10 seconds for 100K+ records
    """
    
    # Normalize filters
    filters = {
        "start_date": start_date if start_date and start_date.strip() else None,
        "end_date": end_date if end_date and end_date.strip() else None,
        "customer_mobile": customer_mobile if customer_mobile and customer_mobile != "All" and customer_mobile.strip() else None,
        "customer_name": customer_name if customer_name and customer_name != "All" and customer_name.strip() else None,
        "r_value_bucket": r_value_bucket if r_value_bucket and r_value_bucket != "All" and r_value_bucket.strip() else None,
        "f_value_bucket": f_value_bucket if f_value_bucket and f_value_bucket != "All" and f_value_bucket.strip() else None,
        "m_value_bucket": m_value_bucket if m_value_bucket and m_value_bucket != "All" and m_value_bucket.strip() else None,
    }
    
    # Generate cache key from filters
    cache_key = generate_cache_key("campaign_dashboard", **filters)
    
    # Try to get from cache
    cached_result = await get_cache(cache_key)
    if cached_result:
        # Return cached result immediately
        return CampaignDashboardOut(**cached_result)
    
    try:
        # Execute all queries in parallel for maximum performance
        # This reduces total query time from sum(queries) to max(queries)
        kpi_data, r_score_data, f_score_data, m_score_data, r_value_bucket_data, visits_data, value_data, segment_data, days_to_return_data, fiscal_year_data = await asyncio.gather(
            _get_kpi_data_optimized(session, filters),
            _get_r_score_data_optimized(session, filters),
            _get_f_score_data_optimized(session, filters),
            _get_m_score_data_optimized(session, filters),
            _get_r_value_bucket_data_optimized(session, filters),
            _get_visits_data_optimized(session, filters),
            _get_value_data_optimized(session, filters),
            _get_segment_data_optimized(session, filters),
            _get_days_to_return_bucket_data_optimized(session, filters),
            _get_fiscal_year_data_optimized(session, filters),
        )
        
        result = CampaignDashboardOut(
            kpi=kpi_data,
            r_score_data=r_score_data,
            f_score_data=f_score_data,
            m_score_data=m_score_data,
            r_value_bucket_data=r_value_bucket_data,
            visits_data=visits_data,
            value_data=value_data,
            segment_data=segment_data,
            days_to_return_bucket_data=days_to_return_data,
            fiscal_year_data=fiscal_year_data,
        )
        
        # Cache the result
        await set_cache(cache_key, result.model_dump(), CACHE_TTL)
        
        # Log audit (fire and forget - don't wait for completion)
        try:
            asyncio.create_task(log_audit(
                session,
                user.inv_user_code,
                "campaign-dashboard",
                None,
                "VIEW_DASHBOARD",
                details=filters,
                remote_addr=(request.client.host if request.client else None),
                independent_txn=True,
            ))
        except Exception:
            # Ignore audit logging errors - don't fail the request
            pass
        
        return result
        
    except Exception as e:
        error_msg = str(e)
        if "doesn't exist" in error_msg.lower() or "table" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail=f"Database table 'crm_analysis' not found. Please create the table first. Error: {error_msg}"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Error loading dashboard data: {error_msg}"
        )


@router.get("/dashboard/filters", response_model=FilterOptions)
async def get_campaign_dashboard_filters_optimized(
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> FilterOptions:
    """
    OPTIMIZED: Get filter options with caching.
    Filter options change infrequently, so caching is very effective here.
    """
    
    cache_key = "campaign_dashboard_filters"
    
    # Try cache first
    cached_result = await get_cache(cache_key)
    if cached_result:
        return FilterOptions(**cached_result)
    
    try:
        # Get distinct mobile and name pairs to create mapping
        mobile_name_query = select(
            InvCrmAnalysis.cust_mobileno,
            InvCrmAnalysis.customer_name
        ).distinct().where(
            and_(
                InvCrmAnalysis.cust_mobileno.isnot(None),
                InvCrmAnalysis.cust_mobileno != "",
                InvCrmAnalysis.customer_name.isnot(None),
                InvCrmAnalysis.customer_name != "",
            )
        ).order_by(InvCrmAnalysis.cust_mobileno).limit(1000)  # Limit for performance
        
        mobile_name_results = await session.execute(mobile_name_query)
        mobile_name_pairs = mobile_name_results.all()
        
        # Build mappings and lists
        customer_mobile_to_name: dict[str, str] = {}
        customer_name_to_mobile: dict[str, str] = {}
        customer_mobiles_set: set[str] = set()
        customer_names_set: set[str] = set()
        
        for row in mobile_name_pairs:
            mobile = str(row.cust_mobileno).strip() if row.cust_mobileno else ""
            name = str(row.customer_name).strip() if row.customer_name else ""
            
            if mobile and name:
                customer_mobiles_set.add(mobile)
                customer_names_set.add(name)
                # Use first occurrence for mapping (or you could use most recent)
                if mobile not in customer_mobile_to_name:
                    customer_mobile_to_name[mobile] = name
                if name not in customer_name_to_mobile:
                    customer_name_to_mobile[name] = mobile
        
        customer_mobiles = sorted(list(customer_mobiles_set))
        customer_names = sorted(list(customer_names_set))
        
        # Predefined buckets (no need to query database)
        r_value_buckets = ["1-200", "200-400", "400-600", "600-800", "800-1000", ">1000"]
        f_value_buckets = ["1", "2", "3", "4", "5"]  # Common F values
        m_value_buckets = ["1-1000", "1000-2000", "2000-3000", "3000-4000", "4000-5000", ">5000"]
        
        result = FilterOptions(
            customer_mobiles=customer_mobiles,
            customer_names=customer_names,
            customer_mobile_to_name=customer_mobile_to_name,
            customer_name_to_mobile=customer_name_to_mobile,
            r_value_buckets=r_value_buckets,
            f_value_buckets=f_value_buckets,
            m_value_buckets=m_value_buckets,
        )
        
        # Cache for 1 hour (filter options change infrequently)
        await set_cache(cache_key, result.model_dump(), 3600)
        
        return result
        
    except Exception as e:
        error_msg = str(e)
        if "doesn't exist" in error_msg.lower() or "table" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail=f"Database table 'crm_analysis' not found. Please create the table first. Error: {error_msg}"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Error loading filter options: {error_msg}"
        )

