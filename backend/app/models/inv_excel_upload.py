"""SQLAlchemy model for the inv_excel_upload configuration table."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvExcelUpload(Base):
    """Represents the Excel templates that are authorised for uploads."""

    __tablename__ = "inv_excel_upload"

    file_name: Mapped[str] = mapped_column(String(255), primary_key=True)
    sheet_name: Mapped[str] = mapped_column(String(255), primary_key=True)