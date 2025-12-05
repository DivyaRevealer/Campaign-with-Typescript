from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


class CompanyBase(BaseModel):
    comp_code: str
    comp_name: str
    comp_add1: Optional[str] = None
    comp_add2: Optional[str] = None
    comp_add3: Optional[str] = None
    comp_city: Optional[str] = None
    comp_state: Optional[str] = None
    comp_country: Optional[str] = None
    comp_zip: Optional[str] = None
    comp_contact_person: Optional[str] = None
    comp_email: Optional[str] = None
    comp_contact_no: Optional[str] = None
    active_flag: str = "Y"


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    expected_updated_at: Optional[datetime]
    comp_name: Optional[str] = None
    comp_add1: Optional[str] = None
    comp_add2: Optional[str] = None
    comp_add3: Optional[str] = None
    comp_city: Optional[str] = None
    comp_state: Optional[str] = None
    comp_country: Optional[str] = None
    comp_zip: Optional[str] = None
    comp_contact_person: Optional[str] = None
    comp_email: Optional[str] = None
    comp_contact_no: Optional[str] = None
    active_flag: Optional[str] = None


class CompanyStatusUpdate(BaseModel):
    expected_updated_at: Optional[datetime]
    active: str


class CompanyOut(CompanyBase):
    model_config = ConfigDict(from_attributes=True)

    created_by: str
    created_at: datetime
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class CompanyListOut(BaseModel):
    items: List[CompanyOut]
    total: int


class CompanySuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    comp_code: str
    comp_name: str
    comp_city: Optional[str] = None
    comp_state: Optional[str] = None
    comp_country: Optional[str] = None
    comp_contact_person: Optional[str] = None
    comp_email: Optional[str] = None
    comp_contact_no: Optional[str] = None