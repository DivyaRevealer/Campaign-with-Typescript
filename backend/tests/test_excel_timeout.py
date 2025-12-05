import anyio
import pytest
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient

from app.core import concurrency
from app.core.config import settings


@pytest.mark.anyio
async def test_excel_operation_timeout(monkeypatch):
    app = FastAPI()

    async def slow_task(*_: object, **__: object):
        await anyio.sleep(settings.EXCEL_OP_TIMEOUT_SEC + 0.1)

    monkeypatch.setattr(concurrency, "run_in_thread_limited", slow_task)
    monkeypatch.setattr(settings, "EXCEL_OP_TIMEOUT_SEC", 0.05)

    @app.get("/excel")
    async def excel_endpoint():
        from anyio import fail_after

        try:
            with fail_after(settings.EXCEL_OP_TIMEOUT_SEC):
                await concurrency.run_in_thread_limited(lambda: None)
        except TimeoutError:
            raise HTTPException(
                status_code=503, detail="Excel processing timed out. Please retry."
            )
        return {"ok": True}

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/excel")
    assert response.status_code == 503
    assert "timed out" in response.json()["detail"]
