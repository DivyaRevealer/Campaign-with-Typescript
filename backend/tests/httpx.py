"""Lightweight httpx-compatible stubs for ASGI testing without network calls."""

from __future__ import annotations

import json
from typing import Any

import anyio


class _Headers(dict[str, str]):
    def get(self, key: str, default: Any = None) -> Any:  # type: ignore[override]
        return super().get(key.lower(), default)

    def __getitem__(self, key: str) -> str:  # type: ignore[override]
        return super().__getitem__(key.lower())


class Response:
    def __init__(self, status_code: int, headers: dict[str, str], body: bytes):
        self.status_code = status_code
        self.headers = _Headers({k.lower(): v for k, v in headers.items()})
        self._body = body

    def json(self) -> Any:
        return json.loads(self._body.decode()) if self._body else None


class AsyncClient:
    def __init__(self, *, app, base_url: str = "http://test"):
        self.app = app
        self.base_url = base_url.rstrip("/")

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def _request(self, method: str, url: str, *, headers: dict[str, str] | None = None, json_body: Any = None):
        body_bytes = b""
        headers = headers or {}
        if json_body is not None:
            body_bytes = json.dumps(json_body).encode()
            headers.setdefault("content-type", "application/json")

        scope = {
            "type": "http",
            "asgi": {"spec_version": "2.3", "version": "3.0"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": url,
            "raw_path": url.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": ("testclient", 0),
            "server": ("testserver", 80),
        }

        message_queue = [{"type": "http.request", "body": body_bytes, "more_body": False}]

        async def receive():
            if message_queue:
                return message_queue.pop(0)
            return {"type": "http.request", "body": b"", "more_body": False}

        status_code = 500
        response_headers: list[tuple[bytes, bytes]] = []
        body_chunks: list[bytes] = []

        async def send(message: dict[str, Any]):
            nonlocal status_code, response_headers
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_headers = message.get("headers", [])
            elif message["type"] == "http.response.body":
                body_chunks.append(message.get("body", b""))

        await self.app(scope, receive, send)

        header_map = {k.decode(): v.decode() for k, v in response_headers}
        return Response(status_code, header_map, b"".join(body_chunks))

    async def post(self, url: str, *, headers: dict[str, str] | None = None, json: Any = None):
        return await self._request("POST", url, headers=headers, json_body=json)

    async def get(self, url: str, *, headers: dict[str, str] | None = None):
        return await self._request("GET", url, headers=headers)

    async def put(self, url: str, *, headers: dict[str, str] | None = None, json: Any = None):
        return await self._request("PUT", url, headers=headers, json_body=json)
