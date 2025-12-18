"""CRM Store Dependency model for store/city/state relationships."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CrmStoreDependency(Base):
    """Dimension table for store/city/state relationships with proper indexes."""

    __tablename__ = "crm_store_dependency"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    store_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

