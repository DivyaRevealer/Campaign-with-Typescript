import asyncio
from sqlalchemy import text
from app.core.config import settings
from app.core.db import SessionLocal

async def main():
    print("JWT_ISSUER:", settings.JWT_ISSUER)
    print("JWT_AUDIENCE:", settings.JWT_AUDIENCE)
    print("DB_POOL_SIZE:", settings.DB_POOL_SIZE)
    print("DB_MAX_OVERFLOW:", settings.DB_MAX_OVERFLOW)
    print("DB_POOL_TIMEOUT:", settings.DB_POOL_TIMEOUT)
    print("DB_POOL_RECYCLE:", settings.DB_POOL_RECYCLE)
    print("DB_ISOLATION_LEVEL:", settings.DB_ISOLATION_LEVEL)
    # Check MySQL session isolation level as seen by SQLAlchemy
    async with SessionLocal() as s:
        r = await s.execute(text("SELECT @@transaction_isolation"))
        print("MySQL @@transaction_isolation:", r.scalar())

if __name__ == "__main__":
    asyncio.run(main())