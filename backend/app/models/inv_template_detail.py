"""Template Detail model for managing WhatsApp templates."""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvTemplateDetail(Base):
    """Template Detail table for managing WhatsApp template information."""

    __tablename__ = "template_details"

    template_name: Mapped[str] = mapped_column(
        String(250), primary_key=True, index=True
    )
    file_url: Mapped[Optional[str]] = mapped_column(String(500))
    file_hvalue: Mapped[Optional[str]] = mapped_column(Text)
    template_type: Mapped[str] = mapped_column(String(50), nullable=False)
    media_type: Mapped[Optional[str]] = mapped_column(String(50))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

