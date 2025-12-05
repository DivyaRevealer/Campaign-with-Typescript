from datetime import datetime
from typing import Optional

from sqlalchemy import CHAR, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvCompanyMaster(Base):
    __tablename__ = "inv_company_master"

    comp_code: Mapped[str] = mapped_column(String(100), primary_key=True)
    comp_name: Mapped[str] = mapped_column(String(255), nullable=False)
    comp_add1: Mapped[Optional[str]] = mapped_column(String(255))
    comp_add2: Mapped[Optional[str]] = mapped_column(String(255))
    comp_add3: Mapped[Optional[str]] = mapped_column(String(255))
    comp_city: Mapped[Optional[str]] = mapped_column(String(100))
    comp_state: Mapped[Optional[str]] = mapped_column(String(100))
    comp_country: Mapped[Optional[str]] = mapped_column(String(100))
    comp_zip: Mapped[Optional[str]] = mapped_column(String(20))
    comp_contact_person: Mapped[Optional[str]] = mapped_column(String(255))
    comp_email: Mapped[Optional[str]] = mapped_column(String(255))
    comp_contact_no: Mapped[Optional[str]] = mapped_column(String(100))
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