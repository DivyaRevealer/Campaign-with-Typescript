"""OPTIMIZED API endpoints for campaign dashboard with caching and parallel execution."""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional
from asyncio import TimeoutError as AsyncTimeoutError

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy import func, select, text, and_, case
from sqlalchemy.sql import text as sql_text
from sqlalchemy.sql import literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.cache import get_cache, set_cache, generate_cache_key
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

# Cache TTL: 1 hour (3600 seconds) for aggressive caching to achieve <1 second load times
# Stale cache will be served while fresh data is fetched in background
CACHE_TTL = 3600
STALE_CACHE_TTL = 7200  # Serve stale cache for up to 2 hours while refreshing


def _apply_base_filters(query, filters: dict):
    """Apply common filters to a query. Optimized with indexed columns."""
    from datetime import datetime as dt
    
    # Date filters - use indexed FIRST_IN_DATE
    start_date = filters.get("start_date")
    if start_date and start_date.strip():
        # Convert string to date object for proper comparison
        try:
            if isinstance(start_date, str):
                start_date_obj = dt.strptime(start_date, "%Y-%m-%d").date()
            else:
                start_date_obj = start_date
            query = query.where(InvCrmAnalysisTcm.first_in_date >= start_date_obj)
        except Exception:
            # Invalid date format - skip filter
            pass
    
    end_date = filters.get("end_date")
    if end_date and end_date.strip():
        # Convert string to date object for proper comparison
        try:
            if isinstance(end_date, str):
                end_date_obj = dt.strptime(end_date, "%Y-%m-%d").date()
            else:
                end_date_obj = end_date
            query = query.where(InvCrmAnalysisTcm.first_in_date <= end_date_obj)
        except Exception:
            # Invalid date format - skip filter
            pass
    
    # Customer filters - use indexed columns
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


async def _get_all_score_distributions_combined(
    session: AsyncSession,
    filters: dict,
) -> tuple[list[ChartDataPoint], list[ChartDataPoint], list[ChartDataPoint], list[ChartDataPoint], list[ChartDataPoint], list[ChartDataPoint]]:
    """
    OPTIMIZED: Get all score distributions (R, F, M) in a SINGLE query using conditional aggregation.
    This reduces database contention from 6 separate queries to 1 query.
    
    Returns: (r_score_data, f_score_data, m_score_data, r_value_bucket_data, visits_data, value_data)
    Note: r_value_bucket_data = r_score_data, visits_data = f_score_data, value_data = m_score_data
    """
    try:
        # Single query that gets all score distributions using conditional aggregation
        # This scans the table ONCE instead of 6 times
        query = select(
            # R-score distribution (counts by r_score 1-5)
            func.sum(case((InvCrmAnalysisTcm.r_score == 1, 1), else_=0)).label("r_score_1"),
            func.sum(case((InvCrmAnalysisTcm.r_score == 2, 1), else_=0)).label("r_score_2"),
            func.sum(case((InvCrmAnalysisTcm.r_score == 3, 1), else_=0)).label("r_score_3"),
            func.sum(case((InvCrmAnalysisTcm.r_score == 4, 1), else_=0)).label("r_score_4"),
            func.sum(case((InvCrmAnalysisTcm.r_score == 5, 1), else_=0)).label("r_score_5"),
            # F-score distribution (counts by f_score 1-5)
            func.sum(case((InvCrmAnalysisTcm.f_score == 1, 1), else_=0)).label("f_score_1"),
            func.sum(case((InvCrmAnalysisTcm.f_score == 2, 1), else_=0)).label("f_score_2"),
            func.sum(case((InvCrmAnalysisTcm.f_score == 3, 1), else_=0)).label("f_score_3"),
            func.sum(case((InvCrmAnalysisTcm.f_score == 4, 1), else_=0)).label("f_score_4"),
            func.sum(case((InvCrmAnalysisTcm.f_score == 5, 1), else_=0)).label("f_score_5"),
            # M-score distribution (counts by m_score 1-5)
            func.sum(case((InvCrmAnalysisTcm.m_score == 1, 1), else_=0)).label("m_score_1"),
            func.sum(case((InvCrmAnalysisTcm.m_score == 2, 1), else_=0)).label("m_score_2"),
            func.sum(case((InvCrmAnalysisTcm.m_score == 3, 1), else_=0)).label("m_score_3"),
            func.sum(case((InvCrmAnalysisTcm.m_score == 4, 1), else_=0)).label("m_score_4"),
            func.sum(case((InvCrmAnalysisTcm.m_score == 5, 1), else_=0)).label("m_score_5"),
        )
        
        # Apply filters
        query = _apply_base_filters(query, filters)
        
        # Execute with timeout
        result = await asyncio.wait_for(
            session.execute(query),
            timeout=60.0
        )
        row = result.first()
        
        if not row:
            # Return empty arrays for all
            empty = []
            return empty, empty, empty, empty, empty, empty
        
        # R-score labels
        r_score_labels = {
            1: "Least Recent",
            2: "Low Recency",
            3: "Moderate Recency",
            4: "Recent Purchase",
            5: "Bought Most Recently",
        }
        
        # F-score labels
        f_score_labels = {
            1: "Most Rarest Visit",
            2: "2",
            3: "3",
            4: "4",
            5: "More Frequent Visit",
        }
        
        # M-score labels
        m_score_labels = {
            1: "Lowest Value",
            2: "Low Value",
            3: "Moderate Value",
            4: "High Value",
            5: "Highest Value",
        }
        
        # Build R-score data
        r_score_data = [
            ChartDataPoint(
                name=r_score_labels.get(score, f"Score {score}"),
                value=float(getattr(row, f"r_score_{score}", 0) or 0),
                count=float(getattr(row, f"r_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        # Build F-score data
        f_score_data = [
            ChartDataPoint(
                name=f_score_labels.get(score, str(score)),
                value=float(getattr(row, f"f_score_{score}", 0) or 0),
                count=float(getattr(row, f"f_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        # Build M-score data
        m_score_data = [
            ChartDataPoint(
                name=f"Category {score}",
                value=float(getattr(row, f"m_score_{score}", 0) or 0),
                count=float(getattr(row, f"m_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        # R-value bucket is the same as R-score (just different labels)
        r_value_bucket_labels = {
            1: "Least Recent",
            2: "Low Recency",
            3: "Moderate Recency",
            4: "Recent Purchase",
            5: "Bought Most Recently",
        }
        r_value_bucket_data = [
            ChartDataPoint(
                name=r_value_bucket_labels.get(score, f"Score {score}"),
                value=float(getattr(row, f"r_score_{score}", 0) or 0),
                count=float(getattr(row, f"r_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        # Visits (frequency) is the same as F-score
        visits_labels = {
            1: "Least Frequent",
            2: "Low Frequency",
            3: "Moderate Frequency",
            4: "Frequent",
            5: "Most Frequent",
        }
        visits_data = [
            ChartDataPoint(
                name=visits_labels.get(score, f"Score {score}"),
                value=float(getattr(row, f"f_score_{score}", 0) or 0),
                count=float(getattr(row, f"f_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        # Value (monetary) is the same as M-score
        value_labels = {
            1: "Lowest Value",
            2: "Low Value",
            3: "Moderate Value",
            4: "High Value",
            5: "Highest Value",
        }
        value_data = [
            ChartDataPoint(
                name=value_labels.get(score, f"Score {score}"),
                value=float(getattr(row, f"m_score_{score}", 0) or 0),
                count=float(getattr(row, f"m_score_{score}", 0) or 0)
            )
            for score in range(1, 6)
        ]
        
        return r_score_data, f_score_data, m_score_data, r_value_bucket_data, visits_data, value_data
        
    except (AsyncTimeoutError, asyncio.TimeoutError):
        print("⚠️  WARNING: Combined score distributions query timed out, returning empty arrays", flush=True)
        empty = []
        return empty, empty, empty, empty, empty, empty
    except Exception as e:
        print(f"⚠️  WARNING: Combined score distributions query failed: {e}, returning empty arrays", flush=True)
        empty = []
        return empty, empty, empty, empty, empty, empty


async def _get_kpi_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> CampaignKPIData:
    """Optimized KPI calculation using single query with multiple aggregations."""
    # CampaignKPIData is already imported at module level
    
    try:
        # Add timeout to KPI query (25 seconds) to prevent blocking other queries
        # This ensures charts can load even if KPI query is slow
        async def _execute_kpi_query():
            # Single optimized query to get all KPI metrics at once
            # No redundant table counts - only query what we need
            query = select(
                func.count(InvCrmAnalysisTcm.cust_mobileno).label("total_customer"),
                func.avg(InvCrmAnalysisTcm.no_of_items).label("unit_per_transaction"),
                func.avg(InvCrmAnalysisTcm.total_sales).label("customer_spending"),
                func.avg(InvCrmAnalysisTcm.days).label("days_to_return"),
                func.sum(case((InvCrmAnalysisTcm.f_score > 1, 1), else_=0)).label("returning_customers"),
                func.sum(InvCrmAnalysisTcm.total_sales).label("total_sales_sum"),
                func.count(InvCrmAnalysisTcm.total_sales).label("sales_count"),
            )
            
            # Apply filters
            query = _apply_base_filters(query, filters)
            
            result = await session.execute(query)
            row = result.first()
            
            if not row:
                return CampaignKPIData(
                    total_customer=0.0,
                    unit_per_transaction=0.0,
                    profit_per_customer=0.0,
                    customer_spending=0.0,
                    days_to_return=0.0,
                    retention_rate=0.0,
                )
            
            # Extract values
            total_customer_raw = getattr(row, 'total_customer', None)
            if total_customer_raw is None:
                try:
                    total_customer_raw = row[0] if hasattr(row, '__getitem__') else None
                except:
                    pass
            
            total_customer = float(total_customer_raw or 0)
            returning_customers = float(row.returning_customers or 0)
            customer_spending_avg = float(row.customer_spending or 0.0)
            
            # Calculate retention rate
            retention_rate = (returning_customers / total_customer * 100) if total_customer > 0 else 0.0
            
            # Calculate profit per customer: Since profit data is not available, 
            # we'll use average transaction value (same as customer_spending) as a proxy
            # This represents average revenue per customer, which is meaningful for campaigns
            # Note: This is the same as customer_spending (avg), but kept separate for clarity
            profit_per_customer = customer_spending_avg
            
            return CampaignKPIData(
                total_customer=total_customer,
                unit_per_transaction=float(row.unit_per_transaction or 0.0),
                profit_per_customer=profit_per_customer,
                customer_spending=float(row.customer_spending or 0.0),
                days_to_return=float(row.days_to_return or 0.0),
                retention_rate=retention_rate,
            )
        
        # Execute with extended timeout for large datasets (2M+ rows)
        # For 2.2M rows, COUNT queries can take 30-60 seconds even with indexes
        # Using 180 seconds (3 minutes) to handle very large datasets
        try:
            # Reduced timeout to 45 seconds - fail fast, cache will handle subsequent requests
            import time
            start = time.time()
            result = await asyncio.wait_for(_execute_kpi_query(), timeout=45.0)
            elapsed = time.time() - start
            print(f"⏱️  KPI query completed in {elapsed:.2f} seconds")
            return result
        except (AsyncTimeoutError, asyncio.TimeoutError):
            print("⚠️  WARNING: KPI query timed out after 45 seconds, returning default values", flush=True)
            print("⚠️  This may indicate missing indexes or database performance issues", flush=True)
            print("⚠️  Verify indexes: python scripts/verify_tcm_indexes.py", flush=True)
            print("⚠️  Create indexes: python scripts/create_tcm_indexes.py", flush=True)
            import sys
            sys.stdout.flush()
            return CampaignKPIData(
                total_customer=0.0,
                unit_per_transaction=0.0,
                profit_per_customer=0.0,
                customer_spending=0.0,
                days_to_return=0.0,
                retention_rate=0.0,
            )
    except Exception as e:
        # If KPI query fails, return default values instead of failing entire request
        # This allows charts to still load even if KPI query has issues
        print(f"Warning: KPI query failed: {e}, returning default values")
        return CampaignKPIData(
            total_customer=0.0,
            unit_per_transaction=0.0,
            profit_per_customer=0.0,
            customer_spending=0.0,
            days_to_return=0.0,
            retention_rate=0.0,
        )


# Legacy functions kept for backward compatibility but not used in optimized path
async def _get_r_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    r_score_data, _, _, _, _, _ = await _get_all_score_distributions_combined(session, filters)
    return r_score_data


async def _get_f_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    _, f_score_data, _, _, _, _ = await _get_all_score_distributions_combined(session, filters)
    return f_score_data


async def _get_m_score_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    _, _, m_score_data, _, _, _ = await _get_all_score_distributions_combined(session, filters)
    return m_score_data


async def _get_r_value_bucket_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    _, _, _, r_value_bucket_data, _, _ = await _get_all_score_distributions_combined(session, filters)
    return r_value_bucket_data


async def _get_visits_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    _, _, _, _, visits_data, _ = await _get_all_score_distributions_combined(session, filters)
    return visits_data


async def _get_value_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[ChartDataPoint]:
    """Legacy: Use _get_all_score_distributions_combined instead."""
    _, _, _, _, _, value_data = await _get_all_score_distributions_combined(session, filters)
    return value_data


async def _get_segment_data_optimized(
    session: AsyncSession,
    filters: dict,
) -> list[SegmentDataPoint]:
    """Optimized segment data using indexed SEGMENT_MAP column."""
    
    query = select(
        InvCrmAnalysisTcm.segment_map,
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
    )
    
    query = _apply_base_filters(query, filters)
    query = query.group_by(InvCrmAnalysisTcm.segment_map)
    
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
            (InvCrmAnalysisTcm.days <= 60, "1-2 Month"),
            (InvCrmAnalysisTcm.days <= 180, "3-6 Month"),
            (InvCrmAnalysisTcm.days <= 730, "1-2 Yr"),
            else_=">2 Yr"
        ).label("bucket"),
        func.count(InvCrmAnalysisTcm.cust_mobileno).label("count")
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
        func.sum(InvCrmAnalysisTcm.fifth_yr_count).label("yr_2020"),
        func.sum(InvCrmAnalysisTcm.fourth_yr_count).label("yr_2021"),
        func.sum(InvCrmAnalysisTcm.third_yr_count).label("yr_2022"),
        func.sum(InvCrmAnalysisTcm.second_yr_count).label("yr_2023"),
        func.sum(InvCrmAnalysisTcm.first_yr_count).label("yr_2024"),
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


async def _refresh_cache_if_stale(
    session: AsyncSession,
    filters: dict,
    cache_key: str,
    stale_cache_key: str,
):
    """Background task to refresh cache if it's getting stale (non-blocking)."""
    try:
        # Check if cache is getting stale using TTL helper (works with Redis and in-memory)
        from app.core.cache import get_cache_ttl
        ttl = await get_cache_ttl(cache_key)
        # If cache has less than 10 minutes left, refresh it
        # ttl > 0 means key exists and has expiry, ttl < 600 means less than 10 minutes
        if 0 < ttl < 600:  # Less than 10 minutes remaining
            await _refresh_cache_background(session, filters, cache_key, stale_cache_key, None, None)
    except Exception:
        # Ignore errors in background refresh
        pass


async def _warm_cache_on_startup():
    """Warm cache on server startup for default filters (non-blocking)."""
    try:
        from app.core.db import SessionLocal
        from datetime import datetime, timedelta
        
        async with SessionLocal() as session:
            # Warm cache for default date range (last 3 months)
            today = datetime.now().date()
            three_months_ago = today - timedelta(days=90)
            
            default_filters = {
                "start_date": three_months_ago.strftime("%Y-%m-%d"),
                "end_date": today.strftime("%Y-%m-%d"),
                "customer_mobile": None,
                "customer_name": None,
                "r_value_bucket": None,
                "f_value_bucket": None,
                "m_value_bucket": None,
            }
            cache_key = generate_cache_key("campaign_dashboard", **default_filters)
            stale_cache_key = f"{cache_key}:stale"
            await _refresh_cache_background(session, default_filters, cache_key, stale_cache_key, None, None)
            print("✅ Dashboard cache warmed on startup (in-memory or Redis)")
    except Exception:
        pass  # Cache warming is optional, don't fail startup


async def _refresh_cache_background(
    session: AsyncSession,
    filters: dict,
    cache_key: str,
    stale_cache_key: str,
    request: Optional[Request],
    user: Optional[InvUserMaster],
):
    """Background task to refresh cache (non-blocking, doesn't delay response)."""
    try:
        # OPTIMIZED: Execute queries in smaller batches to reduce database contention
        # Batch 1: Combined score distributions (replaces 6 separate queries)
        # Batch 2: KPI + Segment + Days-to-return + Fiscal year (4 queries)
        import time
        start_time = time.time()
        
        # Batch 1: Get all score distributions in ONE query
        score_start = time.time()
        r_score_data, f_score_data, m_score_data, r_value_bucket_data, visits_data, value_data = await _get_all_score_distributions_combined(session, filters)
        score_elapsed = time.time() - score_start
        print(f"⏱️  Combined score distributions query completed in {score_elapsed:.2f} seconds (replaced 6 separate queries)")
        
        # Batch 2: Execute remaining queries in parallel (but fewer than before)
        kpi_data, segment_data, days_to_return_data, fiscal_year_data = await asyncio.gather(
            _get_kpi_data_optimized(session, filters),
            _get_segment_data_optimized(session, filters),
            _get_days_to_return_bucket_data_optimized(session, filters),
            _get_fiscal_year_data_optimized(session, filters),
        )
        
        total_elapsed = time.time() - start_time
        print(f"⏱️  All dashboard queries completed in {total_elapsed:.2f} seconds (reduced from 10 queries to 5 queries)")
        
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
        
        # Update both fresh and stale cache
        await set_cache(cache_key, result.model_dump(), CACHE_TTL)
        await set_cache(stale_cache_key, result.model_dump(), STALE_CACHE_TTL)
        
        # Log audit if user info available
        if request and user:
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
                pass
    except Exception:
        # Ignore errors in background refresh - don't break the user experience
        pass


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
    OPTIMIZED: Get campaign dashboard data with caching and reduced query contention.
    
    Performance improvements:
    - Redis caching (1 hour TTL)
    - Reduced from 10 queries to 5 queries (combined score distributions)
    - Single query for all R/F/M score distributions (reduces database contention)
    - Optimized SQL queries with indexes
    - Single query for KPI metrics
    - SQL aggregation instead of Python processing
    
    Expected response time: ~15-30 seconds for 3 months of data (down from ~78 seconds)
    """
    
    # Set default date range to last 3 months if no dates provided
    today = datetime.now().date()
    three_months_ago = today - timedelta(days=90)
    
    # Normalize filters with default date range (last 3 months)
    filters = {
        "start_date": start_date if start_date and start_date.strip() else three_months_ago.strftime("%Y-%m-%d"),
        "end_date": end_date if end_date and end_date.strip() else today.strftime("%Y-%m-%d"),
        "customer_mobile": customer_mobile if customer_mobile and customer_mobile != "All" and customer_mobile.strip() else None,
        "customer_name": customer_name if customer_name and customer_name != "All" and customer_name.strip() else None,
        "r_value_bucket": r_value_bucket if r_value_bucket and r_value_bucket != "All" and r_value_bucket.strip() else None,
        "f_value_bucket": f_value_bucket if f_value_bucket and f_value_bucket != "All" and f_value_bucket.strip() else None,
        "m_value_bucket": m_value_bucket if m_value_bucket and m_value_bucket != "All" and m_value_bucket.strip() else None,
    }
    
    # Default date range is set to last 3 months if not provided
    
    # Generate cache key from filters
    cache_key = generate_cache_key("campaign_dashboard", **filters)
    stale_cache_key = f"{cache_key}:stale"
    
    # Cache bypass disabled - re-enable caching for performance
    # First request will take longer (10-60s for 3 months), subsequent requests will be <100ms from cache
    FORCE_CACHE_BYPASS = False  # Re-enabled caching for better performance
    
    # Try to get from cache (aggressive caching for <1 second response)
    import time
    cache_start = time.time()
    cached_result = await get_cache(cache_key)
    cache_check_time = time.time() - cache_start
    
    if cached_result:
        # Return cached result immediately (<100ms response)
        asyncio.create_task(_refresh_cache_if_stale(session, filters, cache_key, stale_cache_key))
        print(f"✅ Cache HIT! Returning in {cache_check_time:.3f}s (total_customer: {cached_result.get('kpi', {}).get('total_customer', 'N/A')})")
        return CampaignDashboardOut(**cached_result)
    
    # Try stale cache if fresh cache miss (stale-while-revalidate pattern)
    stale_start = time.time()
    stale_result = await get_cache(stale_cache_key)
    stale_check_time = time.time() - stale_start
    
    if stale_result:
        # Return stale cache immediately, refresh in background
        asyncio.create_task(_refresh_cache_background(session, filters, cache_key, stale_cache_key, request, user))
        print(f"✅ Stale cache HIT! Returning in {stale_check_time:.3f}s, refreshing in background")
        return CampaignDashboardOut(**stale_result)
    
    total_cache_time = cache_check_time + stale_check_time
    if total_cache_time > 0.5:
        print(f"⚠️  Cache check took {total_cache_time:.3f}s (Redis may not be running) - querying database (this will take ~15-30s for 3 months)")
    else:
        print(f"❌ Cache MISS (checked in {total_cache_time:.3f}s) - querying database (this will take ~15-30s for 3 months)")
    
    try:
        # OPTIMIZED: Execute queries in smaller batches to reduce database contention
        # Batch 1: Combined score distributions (replaces 6 separate queries with 1 query)
        # Batch 2: KPI + Segment + Days-to-return + Fiscal year (4 queries in parallel)
        # Total: 5 queries instead of 10 queries
        import time
        start_time = time.time()
        print(f"⏱️  Starting optimized query execution at {time.strftime('%H:%M:%S')} (5 queries instead of 10)")
        
        # Batch 1: Get all score distributions in ONE query (reduces contention)
        score_start = time.time()
        r_score_data, f_score_data, m_score_data, r_value_bucket_data, visits_data, value_data = await _get_all_score_distributions_combined(session, filters)
        score_elapsed = time.time() - score_start
        print(f"⏱️  Combined score distributions query completed in {score_elapsed:.2f} seconds (replaced 6 separate queries)")
        
        # Batch 2: Execute remaining queries in parallel (but fewer than before)
        kpi_data, segment_data, days_to_return_data, fiscal_year_data = await asyncio.gather(
            _get_kpi_data_optimized(session, filters),
            _get_segment_data_optimized(session, filters),
            _get_days_to_return_bucket_data_optimized(session, filters),
            _get_fiscal_year_data_optimized(session, filters),
            return_exceptions=True,  # Don't fail entire request if one query fails
        )
        
        elapsed = time.time() - start_time
        print(f"⏱️  All queries completed in {elapsed:.2f} seconds (reduced from 10 queries to 5 queries)")
        
        # Extract results with error handling
        if isinstance(kpi_data, Exception):
            kpi_data = None
        if isinstance(segment_data, Exception):
            segment_data = []
        if isinstance(days_to_return_data, Exception):
            days_to_return_data = []
        if isinstance(fiscal_year_data, Exception):
            fiscal_year_data = []
        
        # If KPI query failed, use default/empty values instead of failing entire request
        if kpi_data is None:
            from app.schemas.campaign_dashboard import CampaignKPIData
            kpi_data = CampaignKPIData(
                total_customer=0.0,
                unit_per_transaction=0.0,
                profit_per_customer=0.0,
                customer_spending=0.0,
                days_to_return=0.0,
                retention_rate=0.0,
            )
            print("Warning: KPI query failed, using default values")
        
        # Log any other query failures but continue
        if isinstance(segment_data, Exception):
            print(f"Warning: segment query failed: {segment_data}, using empty array")
            segment_data = []
        if isinstance(days_to_return_data, Exception):
            print(f"Warning: days_to_return query failed: {days_to_return_data}, using empty array")
            days_to_return_data = []
        if isinstance(fiscal_year_data, Exception):
            print(f"Warning: fiscal_year query failed: {fiscal_year_data}, using empty array")
            fiscal_year_data = []
        
        # Check if we have at least some data - only fail if ALL queries failed
        charts_loaded = any([
            r_score_data, f_score_data, m_score_data, segment_data, days_to_return_data, fiscal_year_data
        ])
        kpi_loaded = kpi_data is not None
        
        if not charts_loaded and not kpi_loaded:
            # All queries failed - this is a real error
            raise Exception("All dashboard queries failed. Please check database connection and table existence.")
        
        # If only KPI failed but charts loaded, continue with default KPI values (already set above)
        if not kpi_loaded and charts_loaded:
            print("Info: KPI query failed but charts loaded successfully. Using default KPI values.")
        
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
        
        # Cache the result (both fresh and stale for fast fallback)
        await set_cache(cache_key, result.model_dump(), CACHE_TTL)
        await set_cache(stale_cache_key, result.model_dump(), STALE_CACHE_TTL)
        
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
                detail=f"Database table 'crm_analysis_tcm' not found. Please create the table first. Error: {error_msg}"
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
    
    # Updated cache key to force refresh after switching from VALUE to SCORE
    cache_key = "campaign_dashboard_filters_v2_scores"
    
    # Try cache first
    cached_result = await get_cache(cache_key)
    if cached_result:
        return FilterOptions(**cached_result)
    
    try:
        # Get distinct mobile and name pairs to create mapping
        mobile_name_query = select(
            InvCrmAnalysisTcm.cust_mobileno,
            InvCrmAnalysisTcm.customer_name
        ).distinct().where(
            and_(
                InvCrmAnalysisTcm.cust_mobileno.isnot(None),
                InvCrmAnalysisTcm.cust_mobileno != "",
                InvCrmAnalysisTcm.customer_name.isnot(None),
                InvCrmAnalysisTcm.customer_name != "",
            )
        ).order_by(InvCrmAnalysisTcm.cust_mobileno).limit(1000)  # Limit for performance
        
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
        
        # Predefined score values (1-5 for all RFM scores)
        r_value_buckets = ["1", "2", "3", "4", "5"]  # R score values
        f_value_buckets = ["1", "2", "3", "4", "5"]  # F score values
        m_value_buckets = ["1", "2", "3", "4", "5"]  # M score values
        
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
                detail=f"Database table 'crm_analysis_tcm' not found. Please create the table first. Error: {error_msg}"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Error loading filter options: {error_msg}"
        )
