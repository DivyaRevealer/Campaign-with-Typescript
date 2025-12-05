from datetime import datetime
from typing import Optional

from sqlalchemy import CHAR, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvUserMaster(Base):
    __tablename__ = "inv_user_master"

    inv_user_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    inv_user_name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    inv_user_pwd: Mapped[str] = mapped_column(String(255), nullable=False)
    inv_display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pwd_last_changed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    pwd_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    must_change_pwd: Mapped[str] = mapped_column(CHAR(1), nullable=False)  # 'Y'/'N'
    active_flag: Mapped[str] = mapped_column(CHAR(1), nullable=False)  # 'Y'/'N'