"""CRM Analysis TCM model for RFM analysis and customer segmentation."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InvCrmAnalysisTcm(Base):
    """CRM Analysis TCM table containing RFM scores and customer segmentation data."""

    __tablename__ = "crm_analysis_tcm"

    cust_mobileno: Mapped[str] = mapped_column(
        "CUST_MOBILENO", String(60), primary_key=True
    )
    customer_name: Mapped[Optional[str]] = mapped_column("CUSTOMER_NAME", String(255))
    dob: Mapped[Optional[date]] = mapped_column("DOB", Date)
    anniv_dt: Mapped[Optional[date]] = mapped_column("ANNIV_DT", Date)
    fin_close_dt: Mapped[Optional[date]] = mapped_column("FIN_CLOSE_DT", Date)
    emi_close_dt: Mapped[Optional[date]] = mapped_column("EMI_CLOSE_DT", Date)

    r_value: Mapped[int] = mapped_column("R_VALUE", Integer, default=0)
    f_value: Mapped[int] = mapped_column("F_VALUE", Integer, default=0)
    m_value: Mapped[int] = mapped_column("M_VALUE", Integer, default=0)
    r_score: Mapped[int] = mapped_column("R_SCORE", Integer, default=0)
    f_score: Mapped[int] = mapped_column("F_SCORE", Integer, default=0)
    m_score: Mapped[int] = mapped_column("M_SCORE", Integer, default=0)

    rfm_score: Mapped[Optional[str]] = mapped_column("RFM_SCORE", String(20))
    segment_map: Mapped[Optional[str]] = mapped_column("SEGMENT_MAP", String(255))
    no_of_items: Mapped[int] = mapped_column("NO_OF_ITEMS", Integer, default=0)
    total_sales: Mapped[float] = mapped_column(
        "TOTAL_SALES", Numeric(53, 2), default=0.00
    )

    first_in_date: Mapped[Optional[date]] = mapped_column("FIRST_IN_DATE", Date)
    prev_in_date: Mapped[Optional[date]] = mapped_column("PREV_IN_DATE", Date)
    last_in_date: Mapped[Optional[date]] = mapped_column("LAST_IN_DATE", Date)

    last_in_store_code: Mapped[Optional[str]] = mapped_column(
        "LAST_IN_STORE_CODE", String(255)
    )
    last_in_store_name: Mapped[Optional[str]] = mapped_column(
        "LAST_IN_STORE_NAME", String(255)
    )
    last_in_store_city: Mapped[Optional[str]] = mapped_column(
        "LAST_IN_STORE_CITY", String(255)
    )
    last_in_store_state: Mapped[Optional[str]] = mapped_column(
        "LAST_IN_STORE_STATE", String(255)
    )

    days: Mapped[int] = mapped_column("DAYS", Integer, default=0)
    first_yr_count: Mapped[int] = mapped_column("FIRST_YR_COUNT", Integer, default=0)
    second_yr_count: Mapped[int] = mapped_column("SECOND_YR_COUNT", Integer, default=0)
    third_yr_count: Mapped[int] = mapped_column("THIRD_YR_COUNT", Integer, default=0)
    fourth_yr_count: Mapped[int] = mapped_column("FOURTH_YR_COUNT", Integer, default=0)
    fifth_yr_count: Mapped[int] = mapped_column("FIFTH_YR_COUNT", Integer, default=0)

    data_updated_time: Mapped[Optional[datetime]] = mapped_column(
        "DATA_UPDATED_TIME", DateTime
    )

