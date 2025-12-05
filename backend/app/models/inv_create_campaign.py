"""Create Campaign model for managing marketing campaigns."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, Numeric, String, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class InvCreateCampaign(Base):
    """Create Campaign table for managing marketing campaigns."""

    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    based_on: Mapped[str] = mapped_column(String(100), nullable=False)
    
    # RFM Mode fields
    rfm_mode: Mapped[Optional[str]] = mapped_column(String(45))
    recency_op: Mapped[Optional[dict]] = mapped_column(JSON)
    recency_min: Mapped[Optional[int]] = mapped_column(Integer)
    recency_max: Mapped[Optional[int]] = mapped_column(Integer)
    
    frequency_op: Mapped[Optional[dict]] = mapped_column(JSON)
    frequency_min: Mapped[Optional[int]] = mapped_column(Integer)
    frequency_max: Mapped[Optional[int]] = mapped_column(Integer)
    
    monetary_op: Mapped[Optional[dict]] = mapped_column(JSON)
    monetary_min: Mapped[Optional[float]] = mapped_column(Numeric(18, 2))
    monetary_max: Mapped[Optional[float]] = mapped_column(Numeric(18, 2))
    
    r_score: Mapped[Optional[dict]] = mapped_column(JSON)
    f_score: Mapped[Optional[dict]] = mapped_column(JSON)
    m_score: Mapped[Optional[dict]] = mapped_column(JSON)
    rfm_segments: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Geography filters
    branch: Mapped[Optional[dict]] = mapped_column(JSON)
    city: Mapped[Optional[dict]] = mapped_column(JSON)
    state: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Date-based filters
    birthday_start: Mapped[Optional[date]] = mapped_column(Date)
    birthday_end: Mapped[Optional[date]] = mapped_column(Date)
    anniversary_start: Mapped[Optional[date]] = mapped_column(Date)
    anniversary_end: Mapped[Optional[date]] = mapped_column(Date)
    
    # Purchase filters
    purchase_type: Mapped[Optional[str]] = mapped_column(String(100))
    purchase_brand: Mapped[Optional[dict]] = mapped_column(JSON)
    section: Mapped[Optional[dict]] = mapped_column(JSON)
    product: Mapped[Optional[dict]] = mapped_column(JSON)
    model: Mapped[Optional[dict]] = mapped_column(JSON)
    item: Mapped[Optional[dict]] = mapped_column(JSON)
    value_threshold: Mapped[Optional[float]] = mapped_column(Numeric(18, 2))
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        server_onupdate=func.now(),
    )

