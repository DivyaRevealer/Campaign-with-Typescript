"""Application entry point for the IMS API service."""

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import router as auth_router
from app.api.routes.clients import router as clients_router
from app.api.routes.companies import router as companies_router
from app.api.routes.content import router as content_router
from app.api.routes.users import router as users_router
from app.api.routes.currencies import router as currencies_router
from app.api.routes.salesorders import router as salesorders_router
from app.api.routes.production import router as production_router
from app.api.routes.production_reports import router as production_reports_router
from app.api.routes.delivery import router as delivery_router
from app.api.routes.delivery_reports import router as delivery_reports_router
from app.api.routes.summary_reports import router as summary_reports_router
from app.api.routes.campaign_dashboard import router as campaign_dashboard_router
from app.api.routes.create_campaign import router as create_campaign_router
from app.api.routes.template import router as template_router
from app.core.config import settings
from app.core.db import get_session
from app.core.logging import setup_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextLogMiddleware
from app.core.rate_limit import init_rate_limiter

setup_logging()

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

init_rate_limiter(app)

app.add_middleware(RequestContextLogMiddleware)

# TODO: Add OpenTelemetry instrumentation hooks (tracing, metrics) once available.


def _cors_origins() -> list[str]:
    if settings.ENV == "prod":
        if not settings.CORS_ALLOWED_ORIGINS:
            raise RuntimeError("CORS_ALLOWED_ORIGINS must be configured for prod")
        return settings.CORS_ALLOWED_ORIGINS
    return settings.CORS_ALLOWED_ORIGINS or ["http://localhost:5173"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-CSRF-Token",
        "Idempotency-Key",
        "X-Request-ID",
    ],
)

app.add_middleware(BodySizeLimitMiddleware)


@app.get("/api/healthz", tags=["system"], summary="Liveness probe")
def healthz() -> dict[str, str]:
    """Simple liveness probe that load balancers and monitors can call."""

    return {"status": "ok"}


@app.get("/api/readyz", tags=["system"], summary="Readiness probe")
async def readyz(session: AsyncSession = Depends(get_session)):
    try:
        await session.execute(text("SELECT 1"))
        return {"ready": True}
    except Exception:
        raise HTTPException(status_code=503, detail="Database not reachable")


app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(currencies_router, prefix="/api")
app.include_router(clients_router, prefix="/api")
app.include_router(companies_router, prefix="/api")
app.include_router(content_router, prefix="/api")
app.include_router(salesorders_router, prefix="/api")
app.include_router(production_router, prefix="/api")
app.include_router(production_reports_router, prefix="/api")
app.include_router(delivery_router, prefix="/api")
app.include_router(delivery_reports_router, prefix="/api")
app.include_router(summary_reports_router, prefix="/api")
app.include_router(campaign_dashboard_router, prefix="/api")
app.include_router(create_campaign_router, prefix="/api")
app.include_router(template_router, prefix="/api")