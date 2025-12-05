"""Password hashing and JWT helper utilities."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from jose import jwt
from passlib.context import CryptContext

from app.core.concurrency import run_in_thread_security
from app.core.config import settings

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if the plain password matches the stored hash."""

    return pwd_context.verify(plain_password, hashed_password)


async def verify_password_async(plain: str, hashed: str) -> bool:
    """Verify the provided password hash in a background thread."""

    return await run_in_thread_security(verify_password, plain, hashed)


def get_password_hash(password: str) -> str:
    """Hash a password using the configured context."""

    return pwd_context.hash(password)


async def get_password_hash_async(plain: str) -> str:
    """Hash a password in a background thread to avoid blocking the loop."""

    return await run_in_thread_security(get_password_hash, plain)


# JWT helpers
ALGORITHM = "HS256"


def _create_token(data: Dict[str, Any], expires: timedelta) -> str:
    now = datetime.now(timezone.utc)
    expire = now + expires
    to_encode = data.copy()
    to_encode.update(
        {
            "exp": expire,
            "iat": now,
            "nbf": now,
            "iss": settings.JWT_ISSUER,
            "aud": settings.JWT_AUDIENCE,
        }
    )
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(data: Dict[str, Any]) -> str:
    minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES or 15
    return _create_token(data, timedelta(minutes=minutes))


def create_refresh_token(data: Dict[str, Any]) -> str:
    days = settings.REFRESH_TOKEN_EXPIRE_DAYS or 30
    return _create_token(data, timedelta(days=days))