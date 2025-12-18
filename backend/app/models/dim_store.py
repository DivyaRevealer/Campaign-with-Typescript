"""Dimension model for Stores."""

from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, DateTime, Integer, ForeignKey

from app.models.base import Base


class DimStore(Base):
    """Dimension table for stores. Small, indexed table for fast filter lookups."""

    __tablename__ = "dim_store"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city_id: Mapped[int] = mapped_column(Integer, ForeignKey("dim_city.id", ondelete="CASCADE"), nullable=False, index=True)
    state_id: Mapped[int] = mapped_column(Integer, ForeignKey("dim_state.id", ondelete="CASCADE"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    city: Mapped["DimCity"] = relationship("DimCity", back_populates="stores")
    state: Mapped["DimState"] = relationship("DimState")

