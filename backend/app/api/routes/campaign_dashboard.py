"""API endpoints for campaign dashboard."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy import func, select, text, and_, or_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.db import get_session
from app.core.deps import get_current_user
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


def _apply_base_filters(query, filters: dict):
    """Apply common filters to a query. Skip filters with value 'All' or empty."""
    # Date filters
    start_date = filters.get("start_date")
    if start_date and start_date.strip():
        query = query.where(InvCrmAnalysis.first_in_date >= start_date)
    
    end_date = filters.get("end_date")
    if end_date and end_date.strip():
        query = query.where(InvCrmAnalysis.first_in_date <= end_date)
    
    # Customer filters - skip if "All" or empty
    customer_mobile = filters.get("customer_mobile")
    if customer_mobile and customer_mobile != "All" and customer_mobile.strip():
        query = query.where(InvCrmAnalysis.cust_mobileno == customer_mobile)
    
    customer_name = filters.get("customer_name")
    if customer_name and customer_name != "All" and customer_name.strip():
        query = query.where(InvCrmAnalysis.customer_name == customer_name)
    
    # R value bucket filter (based on DAYS field) - skip if "All"
    r_value_bucket = filters.get("r_value_bucket")
    if r_value_bucket and r_value_bucket != "All":
        bucket = r_value_bucket
        if bucket == "1-200":
            query = query.where(InvCrmAnalysis.days <= 200)
        elif bucket == "200-400":
            query = query.where(and_(InvCrmAnalysis.days > 200, InvCrmAnalysis.days <= 400))
        elif bucket == "400-600":
            query = query.where(and_(InvCrmAnalysis.days > 400, InvCrmAnalysis.days <= 600))
        elif bucket == "600-800":
            query = query.where(and_(InvCrmAnalysis.days > 600, InvCrmAnalysis.days <= 800))
        elif bucket == "800-1000":
            query = query.where(and_(InvCrmAnalysis.days > 800, InvCrmAnalysis.days <= 1000))
        elif bucket == ">1000":
            query = query.where(InvCrmAnalysis.days > 1000)
    
    # F value bucket filter (based on F_VALUE) - skip if "All"
    f_value_bucket = filters.get("f_value_bucket")
    if f_value_bucket and f_value_bucket != "All":
        try:
            f_value = int(f_value_bucket)
            query = query.where(InvCrmAnalysis.f_value == f_value)
        except (ValueError, TypeError):
            pass  # Invalid value, skip filter
    
    # M value bucket filter (based on TOTAL_SALES) - skip if "All"
    m_value_bucket = filters.get("m_value_bucket")
    if m_value_bucket and m_value_bucket != "All":
        bucket = m_value_bucket
        if bucket == "1-1000":
            query = query.where(InvCrmAnalysis.total_sales <= 1000)
        elif bucket == "1000-2000":
            query = query.where(and_(InvCrmAnalysis.total_sales > 1000, InvCrmAnalysis.total_sales <= 2000))
        elif bucket == "2000-3000":
            query = query.where(and_(InvCrmAnalysis.total_sales > 2000, InvCrmAnalysis.total_sales <= 3000))
        elif bucket == "3000-4000":
            query = query.where(and_(InvCrmAnalysis.total_sales > 3000, InvCrmAnalysis.total_sales <= 4000))
        elif bucket == "4000-5000":
            query = query.where(and_(InvCrmAnalysis.total_sales > 4000, InvCrmAnalysis.total_sales <= 5000))
        elif bucket == ">5000":
            query = query.where(InvCrmAnalysis.total_sales > 5000)
    
    return query


async def _get_kpi_data(
    session: AsyncSession,
    filters: dict,
) -> CampaignKPIData:
    """Calculate KPI metrics from CRM analysis table."""
    
    # Total customers
    total_query = select(func.count(InvCrmAnalysis.cust_mobileno))
    total_query = _apply_base_filters(total_query, filters)
    total_customer = (await session.execute(total_query)).scalar() or 0.0
    
    # Unit per transaction (average items per customer)
    unit_query = select(func.avg(InvCrmAnalysis.no_of_items))
    unit_query = _apply_base_filters(unit_query, filters)
    unit_per_transaction = float((await session.execute(unit_query)).scalar() or 0.0)
    
    # Profit per customer (placeholder - adjust based on your profit calculation)
    profit_per_customer = 0.0
    
    # Customer spending (average spending per customer, not total)
    spending_query = select(func.avg(InvCrmAnalysis.total_sales))
    spending_query = _apply_base_filters(spending_query, filters)
    customer_spending = float((await session.execute(spending_query)).scalar() or 0.0)
    
    # Days to return (average days)
    days_query = select(func.avg(InvCrmAnalysis.days))
    days_query = _apply_base_filters(days_query, filters)
    days_to_return = float((await session.execute(days_query)).scalar() or 0.0)
    
    # Retention rate (customers with f_score > 1 are returning customers)
    retention_query = select(
        func.count(
            case((InvCrmAnalysis.f_score > 1, InvCrmAnalysis.cust_mobileno))
        ) / func.nullif(func.count(InvCrmAnalysis.cust_mobileno), 0) * 100
    )
    retention_query = _apply_base_filters(retention_query, filters)
    retention_rate = float((await session.execute(retention_query)).scalar() or 0.0)
    
    return CampaignKPIData(
        total_customer=float(total_customer),
        unit_per_transaction=unit_per_transaction,
        profit_per_customer=profit_per_customer,
        customer_spending=customer_spending,
        days_to_return=days_to_return,
        retention_rate=retention_rate,
    )


async def _get_r_score_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get R score distribution data."""
    
    # "Bought Most Recently" = R_SCORE = 5 (highest recency score)
    # Everything else is "Other"
    query = select(
        case(
            (InvCrmAnalysis.r_score == 5, "Bought Most Recently"),
            else_="Other"
        ).label("category"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by("category")
    
    results = (await session.execute(query)).all()
    return [
        ChartDataPoint(name=r.category, value=float(r.count), count=float(r.count))
        for r in results
    ]


async def _get_f_score_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get F score distribution data."""
    
    query = select(
        InvCrmAnalysis.f_score,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.f_score).order_by(InvCrmAnalysis.f_score)
    
    results = (await session.execute(query)).all()
    
    # Map scores to labels
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


async def _get_m_score_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get M score distribution data."""
    
    query = select(
        InvCrmAnalysis.m_score,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
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


async def _get_r_value_bucket_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get R value bucket distribution based on DAYS field."""
    
    query = select(
        case(
            (InvCrmAnalysis.days <= 200, "1-200"),
            (InvCrmAnalysis.days <= 400, "200-400"),
            (InvCrmAnalysis.days <= 600, "400-600"),
            (InvCrmAnalysis.days <= 800, "600-800"),
            (InvCrmAnalysis.days <= 1000, "800-1000"),
            else_=">1000"
        ).label("bucket"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by("bucket")
    
    results = (await session.execute(query)).all()
    return [
        ChartDataPoint(name=r.bucket, value=float(r.count))
        for r in results
    ]


async def _get_visits_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get customer visits distribution based on F_VALUE (frequency value)."""
    
    query = select(
        InvCrmAnalysis.f_value,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.f_value).order_by(InvCrmAnalysis.f_value)
    
    results = (await session.execute(query)).all()
    
    return [
        ChartDataPoint(name=str(r.f_value), value=float(r.count))
        for r in results
    ]


async def _get_value_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get customer value distribution based on TOTAL_SALES."""
    
    query = select(
        case(
            (InvCrmAnalysis.total_sales <= 1000, "1-1000"),
            (InvCrmAnalysis.total_sales <= 2000, "1000-2000"),
            (InvCrmAnalysis.total_sales <= 3000, "2000-3000"),
            (InvCrmAnalysis.total_sales <= 4000, "3000-4000"),
            (InvCrmAnalysis.total_sales <= 5000, "4000-5000"),
            else_=">5000"
        ).label("bucket"),
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by("bucket")
    
    results = (await session.execute(query)).all()
    
    return [
        ChartDataPoint(name=r.bucket, value=float(r.count))
        for r in results
    ]


async def _get_segment_data(
    session: AsyncSession,
    filters: dict,
) -> list[SegmentDataPoint]:
    """Get customer segment distribution from SEGMENT_MAP field."""
    
    query = select(
        InvCrmAnalysis.segment_map,
        func.count(InvCrmAnalysis.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysis.segment_map)
    
    results = (await session.execute(query)).all()
    
    # Segment colors mapping
    segment_colors = {
        "CHAMPIONS": "#22c55e",
        "POTENTIAL LOYALISTS": "#7dd3fc",
        "NEW CUSTOMERS": "#1e40af",
        "NEED ATTENTION": "#2dd4bf",
        "AT RISK": "#f97316",
        "LOST": "#ef4444",
        "HIBERNATING": "#94a3b8",
    }
    
    return [
        SegmentDataPoint(
            name=r.segment_map or "Unknown",
            value=float(r.count),
            fill=segment_colors.get(r.segment_map or "Unknown", "#8884d8")
        )
        for r in results
    ]


async def _get_days_to_return_bucket_data(
    session: AsyncSession,
    filters: dict,
) -> list[DaysToReturnBucketData]:
    """Get days to return bucket distribution based on DAYS field."""
    
    # Get all rows with filters applied, then aggregate in Python (matching old logic)
    base_query = select(InvCrmAnalysis)
    base_query = _apply_base_filters(base_query, filters)
    rows = (await session.execute(base_query)).scalars().all()
    
    # Bucket logic - combine to match frontend chart (4 buckets)
    buckets = {
        "1-2 Month": 0,  # 30-60 days (combines "1 Month" + "1-2 Month")
        "3-6 Month": 0,  # 90-180 days (combines "2-3 Month" + "3-6 Month")
        "1-2 Yr": 0,     # 365-730 days (combines "6 Month-1 Yr" + "1-2 Yr")
        ">2 Yr": 0,      # >730 days
    }
    
    for r in rows:
        days = r.days or 0
        if days <= 60:
            buckets["1-2 Month"] += 1
        elif days <= 180:
            buckets["3-6 Month"] += 1
        elif days <= 730:
            buckets["1-2 Yr"] += 1
        else:
            buckets[">2 Yr"] += 1
    
    return [
        DaysToReturnBucketData(name=bucket, count=float(count))
        for bucket, count in buckets.items()
    ]


async def _get_fiscal_year_data(
    session: AsyncSession,
    filters: dict,
) -> list[FiscalYearData]:
    """Get fiscal year customer percentage data based on year count fields."""
    
    # Get all rows with filters applied
    base_query = select(InvCrmAnalysis)
    base_query = _apply_base_filters(base_query, filters)
    rows = (await session.execute(base_query)).scalars().all()
    
    # Calculate year totals from year count fields
    # Note: The old code maps years backwards (FIFTH_YR_COUNT = 2020, FIRST_YR_COUNT = 2024)
    year_totals = {
        "2020": sum(r.fifth_yr_count or 0 for r in rows),
        "2021": sum(r.fourth_yr_count or 0 for r in rows),
        "2022": sum(r.third_yr_count or 0 for r in rows),
        "2023": sum(r.second_yr_count or 0 for r in rows),
        "2024": sum(r.first_yr_count or 0 for r in rows),
    }
    
    # Calculate cumulative old customers and percentages
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


@router.get("/dashboard/filters", response_model=FilterOptions)
async def get_campaign_dashboard_filters(
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> FilterOptions:
    """
    Get available filter options for the campaign dashboard.
    Returns distinct values for customer mobiles, names, and RFM buckets.
    """
    try:
        # Get distinct customer mobile numbers
        mobile_query = select(InvCrmAnalysis.cust_mobileno).distinct().where(
            InvCrmAnalysis.cust_mobileno.isnot(None)
        )
        mobile_results = (await session.execute(mobile_query)).scalars().all()
        customer_mobiles = sorted([str(m) for m in mobile_results if m])
        
        # Get distinct customer names
        name_query = select(InvCrmAnalysis.customer_name).distinct().where(
            InvCrmAnalysis.customer_name.isnot(None)
        )
        name_results = (await session.execute(name_query)).scalars().all()
        customer_names = sorted([str(n) for n in name_results if n])
        
        # Get distinct R value buckets (based on DAYS field)
        r_bucket_query = select(
            case(
                (InvCrmAnalysis.days <= 200, "1-200"),
                (InvCrmAnalysis.days <= 400, "200-400"),
                (InvCrmAnalysis.days <= 600, "400-600"),
                (InvCrmAnalysis.days <= 800, "600-800"),
                (InvCrmAnalysis.days <= 1000, "800-1000"),
                else_=">1000"
            ).label("bucket")
        ).distinct()
        r_bucket_results = (await session.execute(r_bucket_query)).scalars().all()
        r_value_buckets = sorted([str(b) for b in r_bucket_results if b])
        
        # Get distinct F value buckets (based on F_VALUE)
        f_bucket_query = select(InvCrmAnalysis.f_value).distinct()
        f_bucket_results = (await session.execute(f_bucket_query)).scalars().all()
        f_value_buckets = sorted([str(b) for b in f_bucket_results if b is not None])
        
        # Get distinct M value buckets (based on M_VALUE or TOTAL_SALES ranges)
        m_bucket_query = select(
            case(
                (InvCrmAnalysis.total_sales <= 1000, "1-1000"),
                (InvCrmAnalysis.total_sales <= 2000, "1000-2000"),
                (InvCrmAnalysis.total_sales <= 3000, "2000-3000"),
                (InvCrmAnalysis.total_sales <= 4000, "3000-4000"),
                (InvCrmAnalysis.total_sales <= 5000, "4000-5000"),
                else_=">5000"
            ).label("bucket")
        ).distinct()
        m_bucket_results = (await session.execute(m_bucket_query)).scalars().all()
        m_value_buckets = sorted([str(b) for b in m_bucket_results if b])
        
        return FilterOptions(
            customer_mobiles=customer_mobiles,
            customer_names=customer_names,
            r_value_buckets=r_value_buckets,
            f_value_buckets=f_value_buckets,
            m_value_buckets=m_value_buckets,
        )
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


@router.get("/dashboard", response_model=CampaignDashboardOut)
async def get_campaign_dashboard(
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
    Get campaign dashboard data with all metrics and charts.
    
    This endpoint returns:
    - KPI metrics (total customers, unit per transaction, etc.)
    - R/F/M score distributions
    - Customer segment distribution
    - Days to return bucket distribution
    - Fiscal year customer percentage trends
    
    Note: Filter values of "All" or empty strings are ignored (no filter applied).
    """
    """
    Get campaign dashboard data with all metrics and charts.
    
    This endpoint returns:
    - KPI metrics (total customers, unit per transaction, etc.)
    - R/F/M score distributions
    - Customer segment distribution
    - Days to return bucket distribution
    - Fiscal year customer percentage trends
    """
    
    # Normalize filter values - convert empty strings and "All" to None
    filters = {
        "start_date": start_date if start_date and start_date.strip() else None,
        "end_date": end_date if end_date and end_date.strip() else None,
        "customer_mobile": customer_mobile if customer_mobile and customer_mobile != "All" and customer_mobile.strip() else None,
        "customer_name": customer_name if customer_name and customer_name != "All" and customer_name.strip() else None,
        "r_value_bucket": r_value_bucket if r_value_bucket and r_value_bucket != "All" and r_value_bucket.strip() else None,
        "f_value_bucket": f_value_bucket if f_value_bucket and f_value_bucket != "All" and f_value_bucket.strip() else None,
        "m_value_bucket": m_value_bucket if m_value_bucket and m_value_bucket != "All" and m_value_bucket.strip() else None,
    }
    
    try:
        # Fetch all dashboard data in parallel (if needed)
        kpi_data = await _get_kpi_data(session, filters)
        r_score_data = await _get_r_score_data(session, filters)
        f_score_data = await _get_f_score_data(session, filters)
        m_score_data = await _get_m_score_data(session, filters)
        r_value_bucket_data = await _get_r_value_bucket_data(session, filters)
        visits_data = await _get_visits_data(session, filters)
        value_data = await _get_value_data(session, filters)
        segment_data = await _get_segment_data(session, filters)
        days_to_return_bucket_data = await _get_days_to_return_bucket_data(session, filters)
        fiscal_year_data = await _get_fiscal_year_data(session, filters)
        
        await log_audit(
            session,
            user.inv_user_code,
            "campaign-dashboard",
            None,
            "VIEW_DASHBOARD",
            details=filters,
            remote_addr=(request.client.host if request.client else None),
            independent_txn=True,
        )
        
        return CampaignDashboardOut(
            kpi=kpi_data,
            r_score_data=r_score_data,
            f_score_data=f_score_data,
            m_score_data=m_score_data,
            r_value_bucket_data=r_value_bucket_data,
            visits_data=visits_data,
            value_data=value_data,
            segment_data=segment_data,
            days_to_return_bucket_data=days_to_return_bucket_data,
            fiscal_year_data=fiscal_year_data,
        )
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

