from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import settings
from app.core.optimistic_lock import _ensure_expected_timestamp
from app.core.db import get_session, repeatable_read_transaction
from app.core.db_errors import raise_on_lock_conflict
from app.core.deps import get_current_user
from app.models.inv_company import InvCompanyMaster
from app.models.inv_user import InvUserMaster
from app.schemas.company import (
    CompanyCreate,
    CompanyListOut,
    CompanyOut,
    CompanySuggestionOut,
    CompanyUpdate,
    CompanyStatusUpdate,
)

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("/search", response_model=List[CompanySuggestionOut])
async def search_companies(
    request: Request,
    q: str,
    limit: int = 10,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    term = (q or "").strip()
    if not term:
        return []

    like = f"%{term}%"
    stmt = (
        select(InvCompanyMaster)
        .where(
            and_(
                InvCompanyMaster.active_flag == "Y",
                or_(
                    InvCompanyMaster.comp_code.ilike(like),
                    InvCompanyMaster.comp_name.ilike(like),
                ),
            )
        )
        .order_by(InvCompanyMaster.comp_name)
        .limit(limit)
    )

    rows = (await session.execute(stmt)).scalars().all()

    await log_audit(
        session,
        user.inv_user_code,
        "company",
        None,
        "SEARCH",
        details={"q": term, "limit": limit, "count": len(rows)},
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return rows


@router.get("/check-name")
async def check_name(
    name: str,
    exclude_code: Optional[str] = None,
    request: Request = None,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    q = select(InvCompanyMaster.comp_code, InvCompanyMaster.comp_name).where(
        func.lower(InvCompanyMaster.comp_name) == func.lower(name)
    )
    if exclude_code:
        q = q.where(InvCompanyMaster.comp_code != exclude_code)

    row = (await session.execute(q)).first()
    exists = bool(row)

    await log_audit(
        session,
        user.inv_user_code,
        "company",
        None,
        "CHECK_NAME",
        details={"name": name, "exclude_code": exclude_code, "exists": exists},
        remote_addr=(request.client.host if request and request.client else None),
        independent_txn=True,
    )

    if not exists:
        return {"exists": False}
    code, cname = row
    return {"exists": True, "comp_code": code, "comp_name": cname}


@router.get("", response_model=CompanyListOut)
async def list_companies(
    request: Request,
    q: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    active: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    conds = []
    if q:
        like = f"%{q}%"
        conds.append(
            or_(
                InvCompanyMaster.comp_name.ilike(like),
                InvCompanyMaster.comp_city.ilike(like),
                InvCompanyMaster.comp_state.ilike(like),
                InvCompanyMaster.comp_email.ilike(like),
                InvCompanyMaster.comp_contact_no.ilike(like),
            )
        )
    if city:
        conds.append(InvCompanyMaster.comp_city == city)
    if state:
        conds.append(InvCompanyMaster.comp_state == state)
    if active in ("Y", "N"):
        conds.append(InvCompanyMaster.active_flag == active)

    stmt = select(InvCompanyMaster)
    count_stmt = select(func.count()).select_from(InvCompanyMaster)
    if conds:
        c = and_(*conds)
        stmt = stmt.where(c)
        count_stmt = count_stmt.where(c)

    total = (await session.execute(count_stmt)).scalar_one()
    result = await session.execute(
        stmt.order_by(InvCompanyMaster.comp_name).limit(limit).offset(offset)
    )
    items = result.scalars().all()

    await log_audit(
        session,
        user.inv_user_code,
        "company",
        None,
        "LIST",
        details={
            "q": q,
            "city": city,
            "state": state,
            "active": active,
            "limit": limit,
            "offset": offset,
        },
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return CompanyListOut(items=items, total=total)


@router.get("/{comp_code}", response_model=CompanyOut)
async def get_company(
    comp_code: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    obj = await session.scalar(
        select(InvCompanyMaster).where(InvCompanyMaster.comp_code == comp_code)
    )
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Company not found"
        )

    await log_audit(
        session,
        user.inv_user_code,
        "company",
        comp_code,
        "VIEW",
        details=None,
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )

    return obj


@router.post("", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
async def create_company(
    payload: CompanyCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    exists = await session.scalar(
        select(InvCompanyMaster.comp_code).where(
            InvCompanyMaster.comp_code == payload.comp_code
        )
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Company code already exists"
        )

    data = payload.model_dump(exclude_unset=True)
    obj = InvCompanyMaster(**data, created_by=user.inv_user_code)
    session.add(obj)

    await log_audit(
        session,
        user.inv_user_code,
        "company",
        payload.comp_code,
        "CREATE",
        details=data,
        remote_addr=(request.client.host if request.client else None),
    )
    await session.commit()
    await session.refresh(obj)

    return obj


@router.put("/{comp_code}", response_model=CompanyOut)
async def update_company(
    comp_code: str,
    payload: CompanyUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    try:
        async with repeatable_read_transaction(session):
            obj = await session.scalar(
                select(InvCompanyMaster)
                .where(InvCompanyMaster.comp_code == comp_code)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Company not found"
                )

            _ensure_expected_timestamp(obj.updated_at, payload.expected_updated_at)

            data = payload.model_dump(exclude_unset=True, exclude_none=True)
            data.pop("expected_updated_at", None)
            if data:
                await session.execute(
                    update(InvCompanyMaster)
                    .where(InvCompanyMaster.comp_code == comp_code)
                    .values(**data, updated_by=user.inv_user_code, updated_at=datetime.now())
                )
                await log_audit(
                    session,
                    user.inv_user_code,
                    "company",
                    comp_code,
                    "UPDATE",
                    details=data,
                    remote_addr=(request.client.host if request.client else None),
                )
    except OperationalError as exc:
        raise_on_lock_conflict(exc)

    return await session.scalar(
        select(InvCompanyMaster).where(InvCompanyMaster.comp_code == comp_code)
    )


@router.patch("/{comp_code}/status")
async def set_company_status(
    comp_code: str,
    payload: CompanyStatusUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    active = payload.active
    if active not in ("Y", "N"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="active must be 'Y' or 'N'",
        )

    try:
        async with repeatable_read_transaction(session):
            obj = await session.scalar(
                select(InvCompanyMaster)
                .where(InvCompanyMaster.comp_code == comp_code)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
            if not obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Company not found"
                )

            _ensure_expected_timestamp(obj.updated_at, payload.expected_updated_at)

            await session.execute(
                update(InvCompanyMaster)
                .where(InvCompanyMaster.comp_code == comp_code)
                .values(
                    active_flag=active,
                    updated_by=user.inv_user_code,
                    updated_at=datetime.now(),
                )
            )
            await log_audit(
                session,
                user.inv_user_code,
                "company",
                comp_code,
                "STATUS",
                details={"active_flag": active},
                remote_addr=(request.client.host if request.client else None),
            )
    except OperationalError as exc:
        raise_on_lock_conflict(exc)

    return {"ok": True}