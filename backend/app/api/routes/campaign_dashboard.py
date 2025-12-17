"""API endpoints for campaign dashboard."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy import func, select, text, and_, or_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.db import get_session
from app.core.deps import get_current_user
from app.models.inv_crm_analysis_tcm import InvCrmAnalysisTcm
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
        query = query.where(InvCrmAnalysisTcm.first_in_date >= start_date)
    
    end_date = filters.get("end_date")
    if end_date and end_date.strip():
        query = query.where(InvCrmAnalysisTcm.first_in_date <= end_date)
    
    # Customer filters - skip if "All" or empty
    customer_mobile = filters.get("customer_mobile")
    if customer_mobile and customer_mobile != "All" and customer_mobile.strip():
        query = query.where(InvCrmAnalysisTcm.cust_mobileno == customer_mobile)
    
    customer_name = filters.get("customer_name")
    if customer_name and customer_name != "All" and customer_name.strip():
        query = query.where(InvCrmAnalysisTcm.customer_name == customer_name)
    
    # R value bucket filter - use indexed R_SCORE (score 1-5)
    r_value_bucket = filters.get("r_value_bucket")
    if r_value_bucket and r_value_bucket != "All":
        try:
            r_score = int(r_value_bucket)
            query = query.where(InvCrmAnalysisTcm.r_score == r_score)
        except (ValueError, TypeError):
            pass
    
    # F value bucket filter - use indexed F_SCORE (score 1-5)
    f_value_bucket = filters.get("f_value_bucket")
    if f_value_bucket and f_value_bucket != "All":
        try:
            f_score = int(f_value_bucket)
            query = query.where(InvCrmAnalysisTcm.f_score == f_score)
        except (ValueError, TypeError):
            pass
    
    # M value bucket filter - use indexed M_SCORE (score 1-5)
    m_value_bucket = filters.get("m_value_bucket")
    if m_value_bucket and m_value_bucket != "All":
        try:
            m_score = int(m_value_bucket)
            query = query.where(InvCrmAnalysisTcm.m_score == m_score)
        except (ValueError, TypeError):
            pass
    
    return query


async def _get_kpi_data(
    session: AsyncSession,
    filters: dict,
) -> CampaignKPIData:
    """Calculate KPI metrics from CRM analysis table."""
    
    # Total customers
    total_query = select(func.count(InvCrmAnalysisTcm.cust_mobileno))
    total_query = _apply_base_filters(total_query, filters)
    total_customer = (await session.execute(total_query)).scalar() or 0.0
    
    # Unit per transaction (average items per customer)
    unit_query = select(func.avg(InvCrmAnalysisTcm.no_of_items))
    unit_query = _apply_base_filters(unit_query, filters)
    unit_per_transaction = float((await session.execute(unit_query)).scalar() or 0.0)
    
    # Profit per customer (placeholder - adjust based on your profit calculation)
    profit_per_customer = 0.0
    
    # Customer spending (average spending per customer, not total)
    spending_query = select(func.avg(InvCrmAnalysisTcm.total_sales))
    spending_query = _apply_base_filters(spending_query, filters)
    customer_spending = float((await session.execute(spending_query)).scalar() or 0.0)
    
    # Days to return (average days)
    days_query = select(func.avg(InvCrmAnalysisTcm.days))
    days_query = _apply_base_filters(days_query, filters)
    days_to_return = float((await session.execute(days_query)).scalar() or 0.0)
    
    # Retention rate (customers with f_score > 1 are returning customers)
    retention_query = select(
        func.count(
            case((InvCrmAnalysisTcm.f_score > 1, InvCrmAnalysisTcm.cust_mobileno))
        ) / func.nullif(func.count(InvCrmAnalysisTcm.cust_mobileno), 0) * 100
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
            (InvCrmAnalysisTcm.r_score == 5, "Bought Most Recently"),
            else_="Other"
        ).label("category"),
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
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
        InvCrmAnalysisTcm.f_score,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.f_score).order_by(InvCrmAnalysisTcm.f_score)
    
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
        InvCrmAnalysisTcm.m_score,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.m_score).order_by(InvCrmAnalysisTcm.m_score)
    
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
    """Get recency score distribution based on R_SCORE (score 1-5)."""
    
    query = select(
        InvCrmAnalysisTcm.r_score,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.r_score).order_by(InvCrmAnalysisTcm.r_score)
    
    results = (await session.execute(query)).all()
    
    score_labels = {
        1: "Least Recent",
        2: "Low Recency",
        3: "Moderate Recency",
        4: "Recent Purchase",
        5: "Bought Most Recently",
    }
    
    # Create a dictionary from results for quick lookup
    result_dict = {r.r_score: float(r.count) for r in results}
    
    # Always return all 5 scores, with 0 for scores that don't exist
    return [
        ChartDataPoint(
            name=score_labels.get(score, f"Score {score}"),
            value=result_dict.get(score, 0.0),
            count=result_dict.get(score, 0.0)
        )
        for score in range(1, 6)
    ]


async def _get_visits_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get frequency score distribution based on F_SCORE (frequency score 1-5)."""
    
    query = select(
        InvCrmAnalysisTcm.f_score,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.f_score).order_by(InvCrmAnalysisTcm.f_score)
    
    results = (await session.execute(query)).all()
    
    score_labels = {
        1: "Least Frequent",
        2: "Low Frequency",
        3: "Moderate Frequency",
        4: "Frequent",
        5: "Most Frequent",
    }
    
    return [
        ChartDataPoint(
            name=score_labels.get(r.f_score, f"Score {r.f_score}"),
            value=float(r.count),
            count=float(r.count)
        )
        for r in results
    ]


async def _get_value_data(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Get monetary score distribution based on M_SCORE (monetary score 1-5)."""
    
    query = select(
        InvCrmAnalysisTcm.m_score,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.m_score).order_by(InvCrmAnalysisTcm.m_score)
    
    results = (await session.execute(query)).all()
    
    score_labels = {
        1: "Lowest Value",
        2: "Low Value",
        3: "Moderate Value",
        4: "High Value",
        5: "Highest Value",
    }
    
    return [
        ChartDataPoint(
            name=score_labels.get(r.m_score, f"Score {r.m_score}"),
            value=float(r.count),
            count=float(r.count)
        )
        for r in results
    ]


async def _get_segment_data(
    session: AsyncSession,
    filters: dict,
) -> list[SegmentDataPoint]:
    """Get customer segment distribution from SEGMENT_MAP field."""
    
    query = select(
        InvCrmAnalysisTcm.segment_map,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    # Apply filters
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.segment_map)
    
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
    base_query = select(InvCrmAnalysisTcm)
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
    base_query = select(InvCrmAnalysisTcm)
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
        # Get distinct customer mobile numbers - ordered for consistency
        # Filter out None, empty strings, and whitespace-only values
        mobile_query = select(InvCrmAnalysisTcm.cust_mobileno).distinct().where(
            and_(
                InvCrmAnalysisTcm.cust_mobileno.isnot(None),
                InvCrmAnalysisTcm.cust_mobileno != "",
                InvCrmAnalysisTcm.cust_mobileno != " "
            )
        ).order_by(InvCrmAnalysisTcm.cust_mobileno)
        mobile_results = (await session.execute(mobile_query)).scalars().all()
        customer_mobiles = [str(m).strip() for m in mobile_results if m and str(m).strip()]
        
        # Get distinct customer names - ordered for consistency
        # Filter out None, empty strings, and whitespace-only values
        name_query = select(InvCrmAnalysisTcm.customer_name).distinct().where(
            and_(
                InvCrmAnalysisTcm.customer_name.isnot(None),
                InvCrmAnalysisTcm.customer_name != "",
                InvCrmAnalysisTcm.customer_name != " "
            )
        ).order_by(InvCrmAnalysisTcm.customer_name)
        name_results = (await session.execute(name_query)).scalars().all()
        customer_names = [str(n).strip() for n in name_results if n and str(n).strip()]
        
        # Predefined score values (1-5 for all RFM scores)
        # Always return all possible scores, regardless of what's in the database
        r_value_buckets = ["1", "2", "3", "4", "5"]  # R score values
        f_value_buckets = ["1", "2", "3", "4", "5"]  # F score values
        m_value_buckets = ["1", "2", "3", "4", "5"]  # M score values
        
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
                detail=f"Database table 'crm_analysis_tcm' not found. Please create the table first. Error: {error_msg}"
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
                detail=f"Database table 'crm_analysis_tcm' not found. Please create the table first. Error: {error_msg}"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Error loading dashboard data: {error_msg}"
        )

