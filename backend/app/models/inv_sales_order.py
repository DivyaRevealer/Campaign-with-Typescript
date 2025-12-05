"""Sales order header and detail ORM models."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import (
    CHAR,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:  # pragma: no cover - typing helpers
    from app.models.inv_delivery_entry import InvDeliveryHdr
    from app.models.inv_production_entry import InvProductionHdr
    
from app.models.base import Base


class InvSoHdr(Base):
    """Represents the sales order header table (``inv_so_hdr``)."""

    __tablename__ = "inv_so_hdr"

    so_no: Mapped[str] = mapped_column(String(100), primary_key=True)
    so_date: Mapped[date] = mapped_column(Date, nullable=False)
    job_ref_no: Mapped[str] = mapped_column(String(100), nullable=False)
    company_code: Mapped[str] = mapped_column(String(100), nullable=False)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_po_no: Mapped[str] = mapped_column(String(100), nullable=False)
    client_code: Mapped[str] = mapped_column(String(100), nullable=False)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    currency_code: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    so_status: Mapped[str] = mapped_column(CHAR(1), nullable=False, server_default=text("'O'"))
    created_by: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(64))
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    items: Mapped[List["InvSoDtl"]] = relationship(
        back_populates="header", cascade="all, delete-orphan"
    )
    production_entry: Mapped[Optional["InvProductionHdr"]] = relationship(
        "InvProductionHdr", back_populates="sales_order", uselist=False
    )
    delivery_entry: Mapped[Optional["InvDeliveryHdr"]] = relationship(
        "InvDeliveryHdr", back_populates="sales_order", uselist=False
    )


class InvSoDtl(Base):
    """Represents the sales order detail table (``inv_so_dtl``)."""

    __tablename__ = "inv_so_dtl"

    so_no: Mapped[str] = mapped_column(
        String(100), ForeignKey("inv_so_hdr.so_no", ondelete="CASCADE"), primary_key=True
    )
    so_sno: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    so_prod_name: Mapped[str] = mapped_column(String(1000), nullable=False)
    so_part_no: Mapped[str] = mapped_column(String(255), nullable=False)
    so_due_on: Mapped[date] = mapped_column(Date, nullable=False)
    so_qty: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    so_rate: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    so_uom: Mapped[str] = mapped_column(String(50), nullable=False)
    so_disc_per: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), server_default=text("0.00")
    )
    so_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)


    header: Mapped[InvSoHdr] = relationship(back_populates="items")


class InvSoSubDtl(Base):
    """Represents the aggregated sales order detail table (``inv_so_sub_dtl``)."""

    __tablename__ = "inv_so_sub_dtl"
    __table_args__ = (PrimaryKeyConstraint("so_no", "so_prod_name", "so_part_no"),)

    so_no: Mapped[str] = mapped_column(String(100))
    so_prod_name: Mapped[str] = mapped_column(String(1000))
    so_part_no: Mapped[str] = mapped_column(String(255), nullable=False)
    so_qty: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    prod_qty: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0.00")
    )
    dely_qty: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0.00")
    )
    stk_qty: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), Computed("prod_qty - dely_qty", persisted=True), nullable=False
    )