"""Production entry header and detail ORM models."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import CHAR, CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class InvProductionHdr(Base):
    """Represents the production entry header table (``inv_production_hdr``)."""

    __tablename__ = "inv_production_hdr"

    so_no: Mapped[str] = mapped_column(
        String(100), ForeignKey("inv_so_hdr.so_no", ondelete="CASCADE"), primary_key=True
    )
    # Map Python attribute to actual DB column ``so_date``
    production_date: Mapped[date] = mapped_column("so_date", Date, nullable=False)
    # Reflect DB default status column
    prod_status: Mapped[str] = mapped_column(CHAR(1), nullable=False, server_default=text("'O'"))
    created_by: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(64))
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    sales_order: Mapped["InvSoHdr"] = relationship(
        "InvSoHdr", back_populates="production_entry", uselist=False
    )
    items: Mapped[List["InvProductionDtl"]] = relationship(
        back_populates="header", cascade="all, delete-orphan"
    )


class InvProductionDtl(Base):
    """Represents the production entry detail table (``inv_production_dtl``)."""

    __tablename__ = "inv_production_dtl"
    __table_args__ = (
        CheckConstraint("prod_qty > 0", name="ck_inv_production_dtl_prod_qty_positive"),
    )

    so_no: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("inv_production_hdr.so_no", ondelete="CASCADE"),
        primary_key=True,
    )
    so_prod_name: Mapped[str] = mapped_column(String(1000), primary_key=True)
    so_part_no: Mapped[str] = mapped_column(String(255), primary_key=True, nullable=False)
    prod_date: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    prod_qty: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    header: Mapped["InvProductionHdr"] = relationship(back_populates="items")