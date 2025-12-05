import sys, pathlib, asyncio
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from app.core.db import SessionLocal

async def main():
    async with SessionLocal() as s:
        # Simple ping
        one = await s.execute(text("SELECT 1"))
        print("db-ping:", one.scalar())

        # Isolation level check
        iso = await s.execute(text("SELECT @@transaction_isolation"))
        print("transaction_isolation:", iso.scalar())

asyncio.run(main())