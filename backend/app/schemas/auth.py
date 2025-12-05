from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_code: str
    user_name: str
    display_name: str


class ChangePasswordRequest(BaseModel):
    username: str
    current_password: str
    new_password: str