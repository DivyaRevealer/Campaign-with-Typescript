import asyncio
import secrets

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from httpx import AsyncClient
import pytest


async def _build_test_app() -> FastAPI:
    app = FastAPI()
    state = {"id": None, "pending": False, "key": None}
    lock = anyio.Lock()

    @app.post("/resources")
    async def create_resource(request: Request):
        key = request.headers.get("Idempotency-Key")
        if not key:
            raise HTTPException(status_code=400, detail="Idempotency key required")

        async with lock:
            if state["id"] and state["key"] == key and not state["pending"]:
                return {"id": state["id"]}
            if state["pending"] and state["key"] == key:
                raise HTTPException(
                    status_code=409,
                    detail="Request in progress",
                    headers={"Retry-After": "1"},
                )
            state["pending"] = True
            state["key"] = key

        await anyio.sleep(0.05)
        resource_id = state["id"] or secrets.token_hex(4)
        async with lock:
            state["id"] = resource_id
            state["pending"] = False
        return JSONResponse({"id": resource_id}, status_code=201)

    return app


@pytest.mark.anyio
async def test_idempotency_replay_behaviour():
    app = await _build_test_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        key = "dup-key-123"

        async def post_once():
            return await client.post("/resources", headers={"Idempotency-Key": key})

        first, second = await asyncio.gather(post_once(), post_once())

        statuses = {first.status_code, second.status_code}
        assert statuses == {201, 409}
        retry_after = (
            first.headers.get("Retry-After")
            if first.status_code == 409
            else second.headers.get("Retry-After")
        )
        assert retry_after == "1"

        created = first if first.status_code == 201 else second
        resource_id = created.json()["id"]

        replay = await client.post("/resources", headers={"Idempotency-Key": key})
        assert replay.status_code == 200
        assert replay.json()["id"] == resource_id
