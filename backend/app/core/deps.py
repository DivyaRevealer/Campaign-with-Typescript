from fastapi import Depends, HTTPException, status, Request
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.db import get_session
from app.core.security import ALGORITHM
from app.models.inv_user import InvUserMaster
from app.core.logging import user_code_ctx_var


async def get_current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> InvUserMaster:
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type"
            )
        user_code = payload.get("sub")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    if not user_code:
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
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User inactive or not found",
        )
    request.state.user_code = user.inv_user_code
    user_code_ctx_var.set(user.inv_user_code)
    session.expunge(user)
    return user