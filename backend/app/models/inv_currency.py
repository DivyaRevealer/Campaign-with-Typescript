from datetime import datetime
from typing import Optional

from sqlalchemy import CHAR, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvCurrencyMaster(Base):
    """ORM model for the ``inv_currency_master`` table."""

    __tablename__ = "inv_currency_master"

    currency_code: Mapped[str] = mapped_column(CHAR(3), primary_key=True)
    currency_name: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str] = mapped_column(String(255), nullable=False)
    symbol: Mapped[Optional[str]] = mapped_column(String(50))
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(64))
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)