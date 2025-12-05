"""Shared helpers for database error handling."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import OperationalError


def raise_on_lock_conflict(exc: OperationalError) -> None:
    """Translate lock-nowait conflicts into user-friendly HTTP errors."""

    orig = getattr(exc, "orig", None)
    code = None
    if orig and getattr(orig, "args", None):
        try:
            code = int(orig.args[0])
        except (TypeError, ValueError):
            code = None
    message = str(getattr(exc, "orig", exc)).lower()
    if code in {3572} or "could not obtain lock" in message or "could not acquire" in message:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resource is locked by another request. Please retry shortly.",
        ) from exc
    raise exc
