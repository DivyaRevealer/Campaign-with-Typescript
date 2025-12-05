"""Idempotency key tracking table."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CHAR, DateTime, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvIdempotencyKey(Base):
    """Persists processed idempotent requests for replay protection."""

    __tablename__ = "inv_idempotency_key"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_inv_idem_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    resource: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(
        CHAR(1), nullable=False, server_default=text("'P'"), comment="P=pending,C=complete"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    pending_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
