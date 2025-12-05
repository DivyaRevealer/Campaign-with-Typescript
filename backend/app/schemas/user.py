from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    inv_user_code: str
    inv_user_name: str
    inv_display_name: str