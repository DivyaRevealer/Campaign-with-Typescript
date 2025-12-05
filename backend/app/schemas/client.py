from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ClientBase(BaseModel):
    client_code: str
    client_name: str
    client_add1: Optional[str] = None
    client_add2: Optional[str] = None
    client_add3: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_country: Optional[str] = None
    client_zip: Optional[str] = None
    client_contact_person: Optional[str] = None
    client_email: Optional[str] = None
    client_contact_no: Optional[str] = None
    active_flag: str = "Y"


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    expected_updated_at: Optional[datetime]
    client_name: Optional[str] = None
    client_add1: Optional[str] = None
    client_add2: Optional[str] = None
    client_add3: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_country: Optional[str] = None
    client_zip: Optional[str] = None
    client_contact_person: Optional[str] = None
    client_email: Optional[str] = None
    client_contact_no: Optional[str] = None
    active_flag: Optional[str] = None


class ClientStatusUpdate(BaseModel):
    expected_updated_at: Optional[datetime]
    active: str


class ClientOut(ClientBase):
    model_config = ConfigDict(from_attributes=True)

    created_by: str
    created_at: datetime
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class ClientListOut(BaseModel):
    items: List[ClientOut]
    total: int


class ClientSuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    client_code: str
    client_name: str
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_country: Optional[str] = None
    client_contact_person: Optional[str] = None
    client_email: Optional[str] = None
    client_contact_no: Optional[str] = None