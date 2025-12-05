from datetime import datetime
from typing import Optional

from sqlalchemy import CHAR, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvClientMaster(Base):
    __tablename__ = "inv_client_master"

    client_code: Mapped[str] = mapped_column(String(100), primary_key=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_add1: Mapped[Optional[str]] = mapped_column(String(255))
    client_add2: Mapped[Optional[str]] = mapped_column(String(255))
    client_add3: Mapped[Optional[str]] = mapped_column(String(255))
    client_city: Mapped[Optional[str]] = mapped_column(String(100))
    client_state: Mapped[Optional[str]] = mapped_column(String(100))
    client_country: Mapped[Optional[str]] = mapped_column(String(100))
    client_zip: Mapped[Optional[str]] = mapped_column(String(20))
    client_contact_person: Mapped[Optional[str]] = mapped_column(String(255))
    client_email: Mapped[Optional[str]] = mapped_column(String(255))
    client_contact_no: Mapped[Optional[str]] = mapped_column(String(100))
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
    )
    active_flag: Mapped[str] = mapped_column(
        CHAR(1), nullable=False, server_default=text("'Y'")
    )