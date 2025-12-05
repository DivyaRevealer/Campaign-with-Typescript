"""Helpers for optimistic concurrency control."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status


def _ensure_expected_timestamp(
    current: Optional[datetime], expected: Optional[datetime]
) -> None:
    """Raise HTTP 409 if the persisted timestamp does not match the expected value."""

    if current == expected:
        return
    if current is None and expected is None:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Record has been updated by someone else. Please reload and try again.",
    )
