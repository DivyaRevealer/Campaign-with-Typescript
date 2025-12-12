"""Script to check date ranges in CRM analysis table."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis


async def check_date_range():
    """Check min/max dates in CRM analysis table."""
    async with SessionLocal() as session:
        try:
            # Get min and max dates
            query = select(
                func.min(InvCrmAnalysis.first_in_date).label("min_first_date"),
                func.max(InvCrmAnalysis.first_in_date).label("max_first_date"),
                func.min(InvCrmAnalysis.last_in_date).label("min_last_date"),
                func.max(InvCrmAnalysis.last_in_date).label("max_last_date"),
                func.min(InvCrmAnalysis.prev_in_date).label("min_prev_date"),
                func.max(InvCrmAnalysis.prev_in_date).label("max_prev_date"),
            )
            
            result = await session.execute(query)
            row = result.first()
            
            print("=" * 60)
            print("CRM Analysis Table - Date Ranges")
            print("=" * 60)
            print(f"First Visit Date (FIRST_IN_DATE):")
            print(f"  Minimum: {row.min_first_date}")
            print(f"  Maximum: {row.max_first_date}")
            print()
            print(f"Last Visit Date (LAST_IN_DATE):")
            print(f"  Minimum: {row.min_last_date}")
            print(f"  Maximum: {row.max_last_date}")
            print()
            print(f"Previous Visit Date (PREV_IN_DATE):")
            print(f"  Minimum: {row.min_prev_date}")
            print(f"  Maximum: {row.max_prev_date}")
            print()
            print("=" * 60)
            print("RECOMMENDED CAMPAIGN DATES:")
            print("=" * 60)
            print(f"Campaign Start Date: Today or future date")
            print(f"Campaign End Date: 30-90 days from start (typical campaign duration)")
            print()
            print("Note: The campaign dates define when the campaign runs,")
            print("not the date range for customer data analysis.")
            print("Customer visit dates (FIRST_IN_DATE, LAST_IN_DATE) are used")
            print("to identify regular customers and calculate recency.")
            print("=" * 60)
            
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(check_date_range())

