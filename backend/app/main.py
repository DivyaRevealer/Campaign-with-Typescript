"""Application entry point for the IMS API service."""

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
from app.api.routes.campaign_dashboard_optimized import router as campaign_dashboard_router
from app.api.routes.create_campaign import router as create_campaign_router
from app.api.routes.template import router as template_router
from app.core.config import settings
from app.core.db import get_session
from app.core.logging import setup_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextLogMiddleware
from app.core.rate_limit import init_rate_limiter
from app.core.cache import get_redis_client, close_redis_client
import asyncio

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
# Add GZip compression for faster response times
app.add_middleware(GZipMiddleware, minimum_size=1000)


async def _verify_dashboard_indexes():
    """Verify that required indexes exist for campaign dashboard (non-blocking check)."""
    try:
        from sqlalchemy import text
        from app.core.db import SessionLocal
        
        required_indexes = [
            "idx_crm_tcm_first_in_date",
            "idx_crm_tcm_r_score",
            "idx_crm_tcm_f_score",
            "idx_crm_tcm_m_score",
        ]
        
        async with SessionLocal() as session:
            check_sql = text("""
                SELECT INDEX_NAME
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'crm_analysis_tcm'
                AND INDEX_NAME IN :index_names
                GROUP BY INDEX_NAME
            """)
            result = await session.execute(check_sql, {"index_names": tuple(required_indexes)})
            existing = {row[0] for row in result.fetchall()}
            missing = [idx for idx in required_indexes if idx not in existing]
            
            if missing:
                print(f"⚠️  WARNING: Missing {len(missing)} critical indexes on crm_analysis_tcm table!", flush=True)
                print(f"   Missing: {', '.join(missing)}", flush=True)
                print(f"   Dashboard queries will be slow (30-90 seconds instead of 5-10 seconds)", flush=True)
                print(f"   Run: python scripts/create_tcm_indexes.py", flush=True)
            else:
                print("✅ Campaign dashboard indexes verified", flush=True)
    except Exception:
        # Don't fail startup if index check fails
        pass


@app.on_event("startup")
async def startup_event():
    """Initialize Redis connection, verify indexes, and warm cache on startup."""
    # Verify indexes in background (non-blocking)
    asyncio.create_task(_verify_dashboard_indexes())
    
    # Initialize Redis
    if getattr(settings, 'REDIS_ENABLED', True):
        try:
            client = await get_redis_client()
            if client:
                print("✅ Redis cache initialized - Dashboard caching enabled", flush=True)
                # Warm cache in background (non-blocking)
                try:
                    from app.api.routes.campaign_dashboard_optimized import _warm_cache_on_startup
                    asyncio.create_task(_warm_cache_on_startup())
                except Exception:
                    pass  # Cache warming is optional
            # Silently continue without Redis - no warning needed
            # The API works perfectly fine without Redis (still optimized with indexes)
        except Exception:
            # Silently continue without Redis
            pass


@app.on_event("shutdown")
async def shutdown_event():
    """Close Redis connection on shutdown."""
    await close_redis_client()


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