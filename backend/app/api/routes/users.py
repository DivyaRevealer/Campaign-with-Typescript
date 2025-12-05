from fastapi import APIRouter, Depends
from app.core.deps import get_current_user
from app.schemas.user import UserOut
from app.models.inv_user import InvUserMaster

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def me(user: InvUserMaster = Depends(get_current_user)):
    # returns the ORM user; Pydantic v2 will read attributes due to from_attributes=True
    return user