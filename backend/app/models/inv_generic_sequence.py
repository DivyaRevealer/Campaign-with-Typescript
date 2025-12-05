"""Generic sequence table scoped by name (e.g. year-specific SO numbers)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvGenericSequence(Base):
    """Stores reusable sequence counters keyed by name."""

    __tablename__ = "inv_gen_seq_no"

    seq_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    seq_no: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("1"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
    )