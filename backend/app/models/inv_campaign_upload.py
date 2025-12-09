"""Model for campaign upload contacts."""

from sqlalchemy import Column, ForeignKey, Integer, String

from app.models.base import Base


class InvCampaignUpload(Base):
    """Model for storing uploaded campaign contacts."""

    __tablename__ = "campaign_uploads"

    campaign_id = Column(Integer, ForeignKey("campaigns.id"), primary_key=True)
    mobile_no = Column(String(50), primary_key=True)
    name = Column(String(255), nullable=True)
    email_id = Column(String(255), nullable=True)

