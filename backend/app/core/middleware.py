"""Custom ASGI middleware used by the FastAPI app."""

from __future__ import annotations

import time
import uuid

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import request_id_ctx_var, user_code_ctx_var
from app.core.config import settings


class RequestContextLogMiddleware(BaseHTTPMiddleware):
    """Injects request IDs and emits structured access logs."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = request_id
        request_token = request_id_ctx_var.set(request_id)
        user_token = user_code_ctx_var.set("-")
        start = time.perf_counter()
        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            status_code = response.status_code if response else 500
            logger.bind(
                method=request.method,
                path=str(request.url.path),
                status=status_code,
                duration_ms=round(duration_ms, 2),
            ).info("request_completed")
            if response is not None:
                response.headers.setdefault("X-Request-ID", request_id)
            request_id_ctx_var.reset(request_token)
            user_code_ctx_var.reset(user_token)


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests with a declared body larger than the configured limit."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > settings.MAX_UPLOAD_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request entity too large"},
                    )
            except ValueError:
                pass

        return await call_next(request)
