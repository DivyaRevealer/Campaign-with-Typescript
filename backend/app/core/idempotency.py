"""Helpers for enforcing request idempotency across create endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Literal

from fastapi import HTTPException, Request, status
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.inv_idempotency_key import InvIdempotencyKey

MAX_KEY_LENGTH = 128
ResourceName = Literal["sales_order", "production_entry", "delivery_entry"]

LOCK_NOWAIT_ERROR_CODES = {3572}


class IdempotencyClaimState(str, Enum):
    NEW = "new"
    REPLAY = "replay"
    IN_PROGRESS = "in_progress"


@dataclass(slots=True)
class IdempotencyClaim:
    """Represents the result of attempting to claim an idempotency key."""

    state: IdempotencyClaimState
    record: InvIdempotencyKey | None = None
    retry_after: int | None = None


IDEMPOTENCY_TTL = timedelta(minutes=settings.IDEMPOTENCY_TTL_MINUTES)


def _utcnow() -> datetime:
    return datetime.utcnow()


def require_idempotency_key(request: Request) -> str:
    """Extract and validate the Idempotency-Key header."""

    raw = request.headers.get("Idempotency-Key", "")
    key = raw.strip()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header is required for this operation.",
        )
    if len(key) > MAX_KEY_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key must be 128 characters or fewer.",
        )
    return key


def _raise_on_lock_conflict(exc: OperationalError) -> None:
    orig = getattr(exc, "orig", None)
    code = None
    if orig and getattr(orig, "args", None):
        try:
            code = int(orig.args[0])
        except (TypeError, ValueError):
            code = None
    message = str(getattr(exc, "orig", exc)).lower()
    if code in LOCK_NOWAIT_ERROR_CODES or "could not obtain lock" in message or "could not acquire" in message:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resource is locked by another request. Please retry shortly.",
        ) from exc
    raise exc


async def claim_idempotency_key(
    session: AsyncSession,
    *,
    idempotency_key: str,
    resource: ResourceName,
) -> IdempotencyClaim:
    """Attempt to register the key for this resource.

    The first caller inserts the row (state=NEW). Subsequent callers see
    IN_PROGRESS (pending) or REPLAY (completed) states.
    """

    now = _utcnow()
    expires_at = now + IDEMPOTENCY_TTL
    try:
        await session.execute(
            insert(InvIdempotencyKey).values(
                idempotency_key=idempotency_key,
                resource=resource,
                status="P",
                last_seen_at=now,
                pending_expires_at=expires_at,
            )
        )
        await session.flush()
        return IdempotencyClaim(state=IdempotencyClaimState.NEW)
    except IntegrityError:
        now = _utcnow()
        expires_at = now + IDEMPOTENCY_TTL
        try:
            record = await session.scalar(
                select(InvIdempotencyKey)
                .where(InvIdempotencyKey.idempotency_key == idempotency_key)
                .with_for_update(nowait=settings.DB_NOWAIT_LOCKS)
            )
        except OperationalError as exc:
            _raise_on_lock_conflict(exc)
        if not record:
            raise
        if record.status == "C" and record.resource_id:
            record.last_seen_at = now
            await session.flush()
            return IdempotencyClaim(IdempotencyClaimState.REPLAY, record)
        if record.status == "P":
            expired = record.pending_expires_at is None or record.pending_expires_at <= now
            if expired:
                record.pending_expires_at = expires_at
                record.last_seen_at = now
                await session.flush()
                return IdempotencyClaim(IdempotencyClaimState.NEW, record)
            retry_after = max(
                1,
                int(
                    (record.pending_expires_at - now).total_seconds()
                    if record.pending_expires_at
                    else IDEMPOTENCY_TTL.total_seconds()
                ),
            )
            return IdempotencyClaim(
                IdempotencyClaimState.IN_PROGRESS,
                record,
                retry_after=retry_after,
            )
        fallback_retry_after = int(IDEMPOTENCY_TTL.total_seconds()) or 1
        return IdempotencyClaim(
            IdempotencyClaimState.IN_PROGRESS,
            record,
            retry_after=fallback_retry_after,
        )


async def bump_idempotency_heartbeat(
    session: AsyncSession,
    *,
    idempotency_key: str,
) -> None:
    """Extend the TTL for an in-flight idempotency claim."""

    now = _utcnow()
    await session.execute(
        update(InvIdempotencyKey)
        .where(InvIdempotencyKey.idempotency_key == idempotency_key)
        .values(last_seen_at=now, pending_expires_at=now + IDEMPOTENCY_TTL)
    )


async def complete_idempotency_key(
    session: AsyncSession,
    *,
    idempotency_key: str,
    resource_id: str,
) -> None:
    """Mark the request as completed so subsequent replays can short-circuit."""

    now = _utcnow()
    await session.execute(
        update(InvIdempotencyKey)
        .where(InvIdempotencyKey.idempotency_key == idempotency_key)
        .values(
            status="C",
            resource_id=resource_id,
            last_seen_at=now,
            pending_expires_at=None,
        )
    )
