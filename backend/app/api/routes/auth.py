from datetime import datetime
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.logging import user_code_ctx_var
from app.core.security import (
    ALGORITHM,
    create_access_token,
    create_refresh_token,
    get_password_hash_async,
    verify_password_async,
)
from app.models.inv_user import InvUserMaster

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(
    payload: LoginIn,
    response: Response,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    user = (
        await session.execute(
            select(InvUserMaster).where(InvUserMaster.inv_user_name == payload.username)
        )
    ).scalar_one_or_none()

    if (
        not user
        or user.active_flag != "Y"
        or not await verify_password_async(payload.password, user.inv_user_pwd)
    ):
        if user:
            await log_audit(
                session,
                user.inv_user_code,
                "auth",
                None,
                "LOGIN_FAILED",
                details={"reason": "invalid_credentials"},
                remote_addr=(request.client.host if request.client else None),
            )
            await session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # Only stamp last_login_at on successful login (do NOT touch updated_at here)
    await session.execute(
        update(InvUserMaster)
        .where(InvUserMaster.inv_user_code == user.inv_user_code)
        .values(last_login_at=datetime.now())
    )

    csrf_token = secrets.token_urlsafe(32)
    request.state.user_code = user.inv_user_code
    user_code_ctx_var.set(user.inv_user_code)
    access_token = create_access_token({"sub": user.inv_user_code, "type": "access"})
    refresh_token = create_refresh_token(
        {"sub": user.inv_user_code, "type": "refresh", "csrf": csrf_token}
    )

    response.set_cookie(
        key="ims_refresh",
        value=refresh_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=(settings.COOKIE_DOMAIN or None),  # guard for empty domain
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )
    response.set_cookie(
        key=settings.REFRESH_CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=(settings.COOKIE_DOMAIN or None),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/auth/refresh",
    )

    await log_audit(
        session,
        user.inv_user_code,
        "auth",
        None,
        "LOGIN",
        details=None,
        remote_addr=(request.client.host if request.client else None),
    )
    await session.commit()
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    token = request.cookies.get("ims_refresh")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token"
        )
    csrf_cookie = request.cookies.get(settings.REFRESH_CSRF_COOKIE_NAME)
    csrf_header = request.headers.get("X-CSRF-Token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token mismatch"
        )
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
            )
        user_code = payload.get("sub")
        if payload.get("csrf") != csrf_cookie:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token mismatch"
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    user = (
        await session.execute(
            select(InvUserMaster).where(InvUserMaster.inv_user_code == user_code)
        )
    ).scalar_one_or_none()
    if not user or user.active_flag != "Y":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    request.state.user_code = user.inv_user_code
    user_code_ctx_var.set(user.inv_user_code)

    new_access = create_access_token({"sub": user.inv_user_code, "type": "access"})
    response.set_cookie(
        key=settings.REFRESH_CSRF_COOKIE_NAME,
        value=csrf_cookie,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=(settings.COOKIE_DOMAIN or None),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/auth/refresh",
    )

    await log_audit(
        session,
        user.inv_user_code,
        "auth",
        None,
        "REFRESH",
        details=None,
        remote_addr=(request.client.host if request.client else None),
        independent_txn=True,
    )
    return {"access_token": new_access, "token_type": "bearer"}


# ---- change password ----
class ChangePwdIn(BaseModel):
    old_password: str
    new_password: str


def _strong(p: str) -> bool:
    return (
        len(p) >= 8
        and re.search(r"[a-z]", p)
        and re.search(r"[A-Z]", p)
        and re.search(r"\d", p)
        and re.search(r"[^\w\s]", p)
    )


@router.post("/change-password")
async def change_password(
    payload: ChangePwdIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    if not await verify_password_async(payload.old_password, user.inv_user_pwd):
        raise HTTPException(status_code=400, detail="Old password is incorrect")
    if not _strong(payload.new_password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 chars with upper, lower, digit, symbol",
        )

    hashed = await get_password_hash_async(payload.new_password)
    await session.execute(
        update(InvUserMaster)
        .where(InvUserMaster.inv_user_code == user.inv_user_code)
        .values(
            inv_user_pwd=hashed,
            pwd_last_changed_at=datetime.now(),
            must_change_pwd="N",
            updated_at=datetime.now(),  # application-level update (OK to stamp)
        )
    )

    await log_audit(
        session,
        user.inv_user_code,
        "auth",
        None,
        "CHANGE_PWD",
        details=None,
        remote_addr=(request.client.host if request.client else None),
    )
    await session.commit()
    return {"ok": True}