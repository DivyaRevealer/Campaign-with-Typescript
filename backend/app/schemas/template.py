"""Pydantic models for template management."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class TemplateDetailOut(BaseModel):
    """Schema for template detail response."""

    template_name: str = Field(..., description="Template name")
    file_url: Optional[str] = Field(None, description="File URL")
    file_hvalue: Optional[str] = Field(None, description="File HValue")
    template_type: str = Field(..., description="Template type (text, media)")
    media_type: Optional[str] = Field(None, description="Media type (image, video)")
    uploaded_at: Optional[datetime] = Field(None, description="Upload timestamp")

    class Config:
        from_attributes = True


class TemplateCreateRequest(BaseModel):
    """Schema for creating a text template."""

    name: str = Field(..., description="Template name")
    language: str = Field(..., description="Template language code")
    category: str = Field(..., description="Template category")
    components: list = Field(..., description="Template components")


class TemplateSyncRequest(BaseModel):
    """Schema for syncing a template."""

    name: str = Field(..., description="Template name to sync")


class TemplateSendRequest(BaseModel):
    """Schema for sending a template."""

    template_name: str = Field(..., description="Template name")
    phone_numbers: Optional[str] = Field(None, description="Comma-separated phone numbers")
    basedon_value: Optional[str] = Field(None, description="Based on value (upload or Customer Base)")
    campaign_id: Optional[int] = Field(None, description="Campaign ID")

