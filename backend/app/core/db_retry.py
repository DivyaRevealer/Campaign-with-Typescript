"""Helpers for retrying transient database failures (deadlock / lock wait)."""

from __future__ import annotations

import asyncio
import random
from typing import Awaitable, Callable, TypeVar

from loguru import logger
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

T = TypeVar("T")
MYSQL_RETRIABLE_ERROR_CODES = {1205, 1213, 3572}
MYSQL_RETRIABLE_SQLSTATES = {"40001"}


def _extract_error_code(exc: DBAPIError | OperationalError) -> tuple[int | None, str | None]:
    orig = getattr(exc, "orig", None)
    if not orig:
        return None, None
    code = None
    sqlstate = getattr(orig, "sqlstate", None)
    if hasattr(orig, "args") and orig.args:
        try:
            code = int(orig.args[0])
        except (TypeError, ValueError):
            code = None
    return code, sqlstate


def _is_retriable(exc: DBAPIError | OperationalError) -> bool:
    code, sqlstate = _extract_error_code(exc)
    if code == 3572 and settings.DB_NOWAIT_LOCKS:
        return False  # NOWAIT conflicts should not be retried when NOWAIT is enabled
    if code in MYSQL_RETRIABLE_ERROR_CODES:
        return True
    if sqlstate in MYSQL_RETRIABLE_SQLSTATES:
        return True
    message = str(getattr(exc, "orig", exc)).lower()
    return "deadlock" in message or "lock wait timeout" in message


async def with_db_retry(
    session: AsyncSession,
    operation: Callable[[], Awaitable[T]],
    *,
    attempts: int | None = None,
    base_delay: float | None = None,
    jitter: float | None = None,
) -> T:
    """Run the async operation with deadlock/timeout retries and jitter."""

    attempts = attempts or settings.DB_RETRY_ATTEMPTS
    base_delay = base_delay or settings.DB_RETRY_BASE_DELAY
    jitter = jitter if jitter is not None else settings.DB_RETRY_JITTER
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except (OperationalError, DBAPIError) as exc:
            if not _is_retriable(exc):
                raise
            last_error = exc
            await session.rollback()
            sleep_for = base_delay * (2 ** (attempt - 1)) + random.uniform(0, jitter)
            logger.bind(
                attempt=attempt,
                max_attempts=attempts,
                sleep=sleep_for,
                error=str(exc),
            ).warning("db_retry_deadlock")
            await asyncio.sleep(sleep_for)
    if last_error is not None:
        raise last_error
    raise RuntimeError("Operation failed without raising an exception")
