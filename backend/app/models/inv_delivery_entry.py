"""Delivery entry header and detail ORM models."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class InvDeliveryHdr(Base):
    """Represents the delivery entry header table (``inv_delivery_hdr``)."""

    __tablename__ = "inv_delivery_hdr"

    so_no: Mapped[str] = mapped_column(
        String(100), ForeignKey("inv_so_hdr.so_no", ondelete="CASCADE"), primary_key=True
    )
    delivery_date: Mapped[date] = mapped_column("so_date", Date, nullable=False)
    del_status: Mapped[str] = mapped_column(CHAR(1), nullable=False, server_default=text("'O'"))
    created_by: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(64))
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    sales_order: Mapped["InvSoHdr"] = relationship(
        "InvSoHdr", back_populates="delivery_entry", uselist=False
    )
    items: Mapped[List["InvDeliveryDtl"]] = relationship(
        back_populates="header", cascade="all, delete-orphan"
    )


class InvDeliveryDtl(Base):
    """Represents the delivery entry detail table (``inv_delivery_dtl``)."""

    __tablename__ = "inv_delivery_dtl"
    __table_args__ = (
        CheckConstraint("dely_qty > 0", name="ck_inv_delivery_dtl_positive_qty"),
    )

    so_no: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("inv_delivery_hdr.so_no", ondelete="CASCADE"),
        primary_key=True,
    )
    so_prod_name: Mapped[str] = mapped_column(String(1000), primary_key=True)
    so_part_no: Mapped[str] = mapped_column(String(255), primary_key=True, nullable=False)
    dely_date: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    dely_qty: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False
    )

    header: Mapped["InvDeliveryHdr"] = relationship(back_populates="items")
    