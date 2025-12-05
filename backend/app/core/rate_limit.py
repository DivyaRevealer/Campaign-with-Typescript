"""Rate limiting utilities using SlowAPI."""

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from fastapi import FastAPI
from fastapi.responses import JSONResponse

limiter = Limiter(key_func=get_remote_address)


def init_rate_limiter(app: FastAPI) -> None:
    """Attach the rate limiter and exception handler to the FastAPI app."""

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    async def rate_limit_exceeded_handler(request, exc):  # type: ignore[unused-arg]
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})

    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
