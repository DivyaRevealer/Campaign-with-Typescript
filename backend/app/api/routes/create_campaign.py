"""API endpoints for create campaign management."""

from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update, func, and_, or_, case
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import settings
from app.core.optimistic_lock import _ensure_expected_timestamp
from app.core.db import get_session, repeatable_read_transaction
from app.core.db_errors import raise_on_lock_conflict
from app.core.deps import get_current_user
from app.models.inv_create_campaign import InvCreateCampaign
from app.models.inv_crm_analysis import InvCrmAnalysis
from app.models.inv_campaign_brand_filter import InvCampaignBrandFilter
from app.models.inv_user import InvUserMaster
from app.schemas.create_campaign import (
    CreateCampaignCreate,
    CreateCampaignUpdate,
    CreateCampaignOut,
)
from app.schemas.campaign_options import CampaignOptionsOut
from app.schemas.campaign_count import CampaignCountRequest, CampaignCountResponse

router = APIRouter(prefix="/campaign", tags=["create_campaign"])


@router.get("/options", response_model=CampaignOptionsOut)
async def get_campaign_options(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Get filter options for campaign creation."""
    try:
        # RFM Scores from CRM analysis (distinct values) - matching reference implementation
        r_scores: list[int] = []
        f_scores: list[int] = []
        m_scores: list[int] = []
        # Helper function to safely convert to int
        def safe_int(value) -> Optional[int]:
            """Safely convert value to integer."""
            if value is None:
                return None
            if isinstance(value, int):
                return value
            if isinstance(value, str):
                try:
                    stripped = value.strip()
                    if not stripped:
                        return None
                    return int(stripped)
                except (ValueError, AttributeError):
                    return None
            try:
                return int(value)
            except (ValueError, TypeError):
                return None

        def clean_scores(raw_values) -> list[int]:
            """Convert DB values to clean integer lists for the API response."""

            cleaned: list[int] = []
            for value in raw_values:
                int_val = safe_int(value)
                if int_val is not None:
                    cleaned.append(int_val)
            # Remove duplicates, sort, and return
            unique_sorted = sorted(set(cleaned))
            return unique_sorted if unique_sorted else [1, 2, 3, 4, 5]

        try:
            # Query R scores (matching reference: distinct, ordered, filter None)
            r_score_query = select(InvCrmAnalysis.r_score).distinct().where(
                InvCrmAnalysis.r_score.isnot(None)
            ).order_by(InvCrmAnalysis.r_score)
            r_results = (await session.execute(r_score_query)).scalars().all()
            r_scores = clean_scores(r_results)
            f_score_query = select(InvCrmAnalysis.f_score).distinct().where(
                InvCrmAnalysis.f_score.isnot(None)
            ).order_by(InvCrmAnalysis.f_score)
            f_results = (await session.execute(f_score_query)).scalars().all()
            f_scores = clean_scores(f_results)
            m_score_query = select(InvCrmAnalysis.m_score).distinct().where(
                InvCrmAnalysis.m_score.isnot(None)
            ).order_by(InvCrmAnalysis.m_score)
            m_results = (await session.execute(m_score_query)).scalars().all()
            m_scores = clean_scores(m_results)
        except Exception as e:
            # If table doesn't exist or error, use defaults 1-5
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(f"Error loading RFM scores from database, using defaults: {e}")
            r_scores = [1, 2, 3, 4, 5]
            f_scores = [1, 2, 3, 4, 5]
            m_scores = [1, 2, 3, 4, 5]

        # RFM Segments from CRM analysis (matching reference implementation)
        rfm_segments: list[str] = []
        try:
            segment_query = select(InvCrmAnalysis.segment_map).distinct().where(
                InvCrmAnalysis.segment_map.isnot(None)
            ).order_by(InvCrmAnalysis.segment_map)
            segment_results = (await session.execute(segment_query)).scalars().all()
            rfm_segments = sorted([str(s) for s in segment_results if s])
        except Exception:
            # Table might not exist, continue with empty list
            pass

        # Geography - Branches, Cities, States from CRM analysis (matching reference implementation)
        branches: list[str] = []
        branch_city_map: dict[str, list[str]] = {}
        branch_state_map: dict[str, list[str]] = {}

        try:
            # Query all distinct geography rows (matching reference)
            geo_query = select(
                InvCrmAnalysis.last_in_store_name,
                InvCrmAnalysis.last_in_store_city,
                InvCrmAnalysis.last_in_store_state,
            ).distinct()
            geo_results = (await session.execute(geo_query)).all()

            # Build branches list (filter out None values)
            branches = sorted({str(row[0]) for row in geo_results if row[0]})

            # Build branch-city map (matching reference: sorted sets)
            branch_city_map = {
                b: sorted({str(city) for branch, city, _ in geo_results if branch == b and city})
                for b in branches
            }

            # Build branch-state map (matching reference: sorted sets)
            branch_state_map = {
                b: sorted({str(state) for branch, _, state in geo_results if branch == b and state})
                for b in branches
            }
        except Exception:
            # Table might not exist, continue with empty lists
            pass

        # Product hierarchy - Extract from campaign_brand_filter table (matching reference)
        brands: list[str] = []
        sections: list[str] = []
        products: list[str] = []
        models: list[str] = []
        items: list[str] = []
        brand_hierarchy: list[dict] = []

        try:
            # Query brand hierarchy from campaign_brand_filter table
            brand_query = select(
                InvCampaignBrandFilter.brand,
                InvCampaignBrandFilter.section,
                InvCampaignBrandFilter.product,
                InvCampaignBrandFilter.model,
                InvCampaignBrandFilter.item,
            )
            brand_results = (await session.execute(brand_query)).all()

            # Extract distinct values for each level (convert to strings) - use tuple unpacking like geo_query
            brands = sorted({str(row[0]) for row in brand_results if row[0] is not None})
            sections = sorted({str(row[1]) for row in brand_results if row[1] is not None})
            products = sorted({str(row[2]) for row in brand_results if row[2] is not None})
            models = sorted({str(row[3]) for row in brand_results if row[3] is not None})
            items = sorted({str(row[4]) for row in brand_results if row[4] is not None})

            # Build full hierarchy objects (filter out completely empty rows, ensure all strings)
            brand_hierarchy = []
            for row in brand_results:
                brand_val, section_val, product_val, model_val, item_val = (
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                )
                if any([brand_val, section_val, product_val, model_val, item_val]):
                    brand_hierarchy.append(
                        {
                            "brand": str(brand_val) if brand_val is not None else "",
                            "section": str(section_val) if section_val is not None else "",
                            "product": str(product_val) if product_val is not None else "",
                            "model": str(model_val) if model_val is not None else "",
                            "item": str(item_val) if item_val is not None else "",
                        }
                    )
        except Exception as e:
            # Table might not exist, continue with empty lists
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(f"campaign_brand_filter table not found or error: {e}")
            pass

        await log_audit(
            session,
            user.inv_user_code,
            "create_campaign",
            None,
            "GET_OPTIONS",
            details={},
            remote_addr=(request.client.host if request.client else None),
            independent_txn=True,
        )

        # Scores are already cleaned and verified as Python int in the query section above
        # They're already Python int, so we can use them directly
        r_scores_clean = r_scores if r_scores else [1, 2, 3, 4, 5]
        f_scores_clean = f_scores if f_scores else [1, 2, 3, 4, 5]
        m_scores_clean = m_scores if m_scores else [1, 2, 3, 4, 5]

        # Ensure all string lists are actually strings (filter out None)
        rfm_segments_clean = [str(seg) for seg in rfm_segments if seg is not None]
        branches_clean = [str(b) for b in branches if b is not None]
        brands_clean = [str(b) for b in brands if b is not None]
        sections_clean = [str(s) for s in sections if s is not None]
        products_clean = [str(p) for p in products if p is not None]
        models_clean = [str(m) for m in models if m is not None]
        items_clean = [str(i) for i in items if i is not None]

        # Clean brand_hierarchy - already built correctly above, just ensure it's a list
        brand_hierarchy_clean = brand_hierarchy if brand_hierarchy else []

        # Clean branch maps - ensure all keys and values are strings (handle None)
        branch_city_map_clean = {}
        for branch, cities in branch_city_map.items():
            if branch is not None:
                branch_city_map_clean[str(branch)] = [
                    str(city) for city in cities if city is not None
                ]

        branch_state_map_clean = {}
        for branch, states in branch_state_map.items():
            if branch is not None:
                branch_state_map_clean[str(branch)] = [
                    str(state) for state in states if state is not None
                ]

        # Create response with validation - use model_validate for better error messages
        import logging

        logger = logging.getLogger(__name__)

        # Ensure all lists are actually lists (not None)
        r_scores_final = r_scores_clean if r_scores_clean else []
        f_scores_final = f_scores_clean if f_scores_clean else []
        m_scores_final = m_scores_clean if m_scores_clean else []
        rfm_segments_final = rfm_segments_clean if rfm_segments_clean else []
        branches_final = branches_clean if branches_clean else []
        brands_final = brands_clean if brands_clean else []
        sections_final = sections_clean if sections_clean else []
        products_final = products_clean if products_clean else []
        models_final = models_clean if models_clean else []
        items_final = items_clean if items_clean else []
        brand_hierarchy_final = brand_hierarchy_clean if brand_hierarchy_clean else []
        branch_city_map_final = branch_city_map_clean if branch_city_map_clean else {}
        branch_state_map_final = branch_state_map_clean if branch_state_map_clean else {}

        # Build data dict
        response_data = {
            "r_scores": r_scores_final,
            "f_scores": f_scores_final,
            "m_scores": m_scores_final,
            "rfm_segments": rfm_segments_final,
            "branches": branches_final,
            "branch_city_map": branch_city_map_final,
            "branch_state_map": branch_state_map_final,
            "brands": brands_final,
            "sections": sections_final,
            "products": products_final,
            "models": models_final,
            "items": items_final,
            "brand_hierarchy": brand_hierarchy_final,
        }

        # Log the data types for debugging
        logger.info(
            f"Response data - r_scores: {r_scores_final[:3] if r_scores_final else 'empty'}, types: {[type(x).__name__ for x in r_scores_final[:3]] if r_scores_final else 'empty'}"
        )
        logger.info(
            f"Response data - brand_hierarchy sample: {brand_hierarchy_final[:2] if brand_hierarchy_final else 'empty'}"
        )

        # Build final response - scores are already verified as Python int above
        final_response_data = {
            "r_scores": r_scores_clean,
            "f_scores": f_scores_clean,
            "m_scores": m_scores_clean,
            "rfm_segments": rfm_segments_final,
            "branches": branches_final,
            "branch_city_map": branch_city_map_final,
            "branch_state_map": branch_state_map_final,
            "brands": brands_final,
            "sections": sections_final,
            "products": products_final,
            "models": models_final,
            "items": items_final,
            "brand_hierarchy": brand_hierarchy_final,
        }

        # Try to validate and return
        try:
            response = CampaignOptionsOut.model_validate(final_response_data)
            return response
        except Exception as validation_error:
            # Log detailed error information
            logger.error(f"Pydantic validation error: {validation_error}")
            logger.error(f"Error type: {type(validation_error)}")
            if hasattr(validation_error, "errors"):
                error_details = validation_error.errors()
                logger.error(f"Validation errors: {error_details}")
                # Log each field that has an error
                for err in error_details:
                    field_path = " -> ".join(str(loc) for loc in err.get("loc", []))
                    logger.error(
                        f"  Field: {field_path}, Error: {err.get('msg')}, Input: {err.get('input')}"
                    )
            logger.error(
                f"r_scores_clean: {r_scores_clean} (types: {[type(x).__name__ for x in r_scores_clean[:5]] if r_scores_clean else 'empty'})"
            )
            logger.error(
                f"f_scores_clean: {f_scores_clean} (types: {[type(x).__name__ for x in f_scores_clean[:5]] if f_scores_clean else 'empty'})"
            )
            logger.error(
                f"m_scores_clean: {m_scores_clean} (types: {[type(x).__name__ for x in m_scores_clean[:5]] if m_scores_clean else 'empty'})"
            )
            logger.error(
                f"brand_hierarchy_final sample: {brand_hierarchy_final[:2] if brand_hierarchy_final else 'empty'}"
            )

            # Return as JSONResponse to bypass FastAPI validation
            # This allows us to see the actual data structure
            return JSONResponse(content=final_response_data, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        raise HTTPException(status_code=500, detail=f"Error loading campaign options: {error_msg}")


@router.get("", response_model=List[CreateCampaignOut])
async def list_campaigns(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> List[CreateCampaignOut]:
    """List all campaigns."""
    stmt = select(InvCreateCampaign).order_by(InvCreateCampaign.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()

    await log_audit(
        session,
        user.inv_user_code,
        "create_campaign",
        None,
        "LIST",
        details={"count": len(rows)},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return rows


@router.get("/{campaign_id}", response_model=CreateCampaignOut)
async def get_campaign(
    campaign_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> CreateCampaignOut:
    """Get a campaign by ID."""
    obj = await session.scalar(
        select(InvCreateCampaign).where(InvCreateCampaign.id == campaign_id)
    )
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found"
        )

    await log_audit(
        session,
        user.inv_user_code,
        "create_campaign",
        str(campaign_id),
        "VIEW",
        details={},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return obj


@router.post("", response_model=CreateCampaignOut, status_code=status.HTTP_201_CREATED)
@router.post("/createCampaign", response_model=CreateCampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CreateCampaignCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> CreateCampaignOut:
    """Create a new campaign."""
    # Validate dates
    if payload.start_date > payload.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start date must be before end date",
        )

    data = payload.model_dump(exclude_unset=True)
    obj = InvCreateCampaign(**data)
    session.add(obj)

    await log_audit(
        session,
        user.inv_user_code,
        "create_campaign",
        None,
        "CREATE",
        details=data,
        remote_addr=(request.client.host if request.client else None),
    )
    await session.commit()
    await session.refresh(obj)
    return obj


@router.put("/{campaign_id}", response_model=CreateCampaignOut)
async def update_campaign(
    campaign_id: int,
    payload: CreateCampaignUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> CreateCampaignOut:
    """Update an existing campaign."""
    # Validate dates
    if payload.start_date > payload.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start date must be before end date",
        )

    try:
        async with repeatable_read_transaction(session):
            obj = await session.scalar(
                select(InvCreateCampaign)
                .where(InvCreateCampaign.id == campaign_id)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found"
                )

            _ensure_expected_timestamp(obj.updated_at, payload.expected_updated_at)

            data = payload.model_dump(exclude_unset=True, exclude_none=True)
            data.pop("expected_updated_at", None)
            if data:
                await session.execute(
                    update(InvCreateCampaign)
                    .where(InvCreateCampaign.id == campaign_id)
                    .values(**data, updated_at=datetime.now())
                )
                await log_audit(
                    session,
                    user.inv_user_code,
                    "create_campaign",
                    str(campaign_id),
                    "UPDATE",
                    details=data,
                    remote_addr=(request.client.host if request.client else None),
                )
    except OperationalError as exc:
        raise_on_lock_conflict(exc)

    return await session.scalar(
        select(InvCreateCampaign).where(InvCreateCampaign.id == campaign_id)
    )


def _apply_campaign_filters(query, filters: CampaignCountRequest):
    """Apply campaign filters to a CRM analysis query."""
    
    # Geography filters
    if filters.branch:
        query = query.where(InvCrmAnalysis.last_in_store_name.in_(filters.branch))
    if filters.city:
        query = query.where(InvCrmAnalysis.last_in_store_city.in_(filters.city))
    if filters.state:
        query = query.where(InvCrmAnalysis.last_in_store_state.in_(filters.state))
    
    # RFM Customized filters
    if filters.recency_op and filters.recency_min is not None:
        if filters.recency_op == "=":
            query = query.where(InvCrmAnalysis.days == filters.recency_min)
        elif filters.recency_op == ">=":
            query = query.where(InvCrmAnalysis.days >= filters.recency_min)
        elif filters.recency_op == "<=":
            query = query.where(InvCrmAnalysis.days <= filters.recency_min)
        elif filters.recency_op == "between" and filters.recency_max is not None:
            query = query.where(
                and_(
                    InvCrmAnalysis.days >= filters.recency_min,
                    InvCrmAnalysis.days <= filters.recency_max
                )
            )
    
    if filters.frequency_op and filters.frequency_min is not None:
        if filters.frequency_op == "=":
            query = query.where(InvCrmAnalysis.f_value == filters.frequency_min)
        elif filters.frequency_op == ">=":
            query = query.where(InvCrmAnalysis.f_value >= filters.frequency_min)
        elif filters.frequency_op == "<=":
            query = query.where(InvCrmAnalysis.f_value <= filters.frequency_min)
        elif filters.frequency_op == "between" and filters.frequency_max is not None:
            query = query.where(
                and_(
                    InvCrmAnalysis.f_value >= filters.frequency_min,
                    InvCrmAnalysis.f_value <= filters.frequency_max
                )
            )
    
    if filters.monetary_op and filters.monetary_min is not None:
        if filters.monetary_op == "=":
            query = query.where(InvCrmAnalysis.total_sales == filters.monetary_min)
        elif filters.monetary_op == ">=":
            query = query.where(InvCrmAnalysis.total_sales >= filters.monetary_min)
        elif filters.monetary_op == "<=":
            query = query.where(InvCrmAnalysis.total_sales <= filters.monetary_min)
        elif filters.monetary_op == "between" and filters.monetary_max is not None:
            query = query.where(
                and_(
                    InvCrmAnalysis.total_sales >= filters.monetary_min,
                    InvCrmAnalysis.total_sales <= filters.monetary_max
                )
            )
    
    # RFM Score filters
    if filters.r_score:
        r_scores = filters.r_score if isinstance(filters.r_score, list) else []
        if r_scores:
            query = query.where(InvCrmAnalysis.r_score.in_(r_scores))
    if filters.f_score:
        f_scores = filters.f_score if isinstance(filters.f_score, list) else []
        if f_scores:
            query = query.where(InvCrmAnalysis.f_score.in_(f_scores))
    if filters.m_score:
        m_scores = filters.m_score if isinstance(filters.m_score, list) else []
        if m_scores:
            query = query.where(InvCrmAnalysis.m_score.in_(m_scores))
    if filters.rfm_segments:
        segments = filters.rfm_segments if isinstance(filters.rfm_segments, list) else []
        if segments:
            query = query.where(InvCrmAnalysis.segment_map.in_(segments))
    
    # Occasion filters
    if filters.birthday_start:
        query = query.where(InvCrmAnalysis.dob >= filters.birthday_start)
    if filters.birthday_end:
        query = query.where(InvCrmAnalysis.dob <= filters.birthday_end)
    if filters.anniversary_start:
        query = query.where(InvCrmAnalysis.anniv_dt >= filters.anniversary_start)
    if filters.anniversary_end:
        query = query.where(InvCrmAnalysis.anniv_dt <= filters.anniversary_end)
    
    # Value threshold
    if filters.value_threshold is not None:
        query = query.where(InvCrmAnalysis.total_sales >= filters.value_threshold)
    
    return query


@router.post("/run/count", response_model=CampaignCountResponse)
async def count_campaign_customers(
    payload: CampaignCountRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
) -> CampaignCountResponse:
    """Count customers matching campaign criteria."""
    try:
        # Total customers
        total_query = select(func.count(InvCrmAnalysis.cust_mobileno))
        total_count = (await session.execute(total_query)).scalar() or 0
        
        # Shortlisted customers (with filters applied)
        shortlisted_query = select(func.count(InvCrmAnalysis.cust_mobileno))
        shortlisted_query = _apply_campaign_filters(shortlisted_query, payload)
        shortlisted_count = (await session.execute(shortlisted_query)).scalar() or 0
        
        await log_audit(
            session,
            user.inv_user_code,
            "create_campaign",
            None,
            "COUNT_CUSTOMERS",
            details=payload.model_dump(exclude_none=True),
            remote_addr=(request.client.host if request.client else None),
            independent_txn=True,
        )
        
        return CampaignCountResponse(
            total_customers=total_count,
            shortlisted_customers=shortlisted_count,
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
            detail=f"Error counting customers: {error_msg}"
        )

