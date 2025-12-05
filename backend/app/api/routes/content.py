from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
import json

router = APIRouter(prefix="/content", tags=["content"])


class HomeContent(BaseModel):
    title: str
    html: str


ROOT = Path(__file__).resolve().parents[3]  # .../backend
FILE = ROOT / "content" / "home.json"


@router.get("/home", response_model=HomeContent)
async def get_home():
    if FILE.exists():
        data = json.loads(FILE.read_text(encoding="utf-8"))
        return HomeContent(title=data.get("title", "Home"), html=data.get("html", ""))
    return HomeContent(title="Home", html="<p>Use the menu to navigate.</p>")