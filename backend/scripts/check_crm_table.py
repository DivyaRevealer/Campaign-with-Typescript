"""Script to check if crm_analysis table exists and show its structure."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text, inspect
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal, engine


async def check_table_exists():
    """Check if crm_analysis table exists and show its structure."""
    async with SessionLocal() as session:
        try:
            # Check if table exists
            result = await session.execute(
                text("""
                    SELECT COUNT(*) as table_count
                    FROM information_schema.tables 
                    WHERE table_schema = DATABASE()
                    AND table_name = 'crm_analysis'
                """)
            )
            table_exists = result.scalar() > 0
            
            if table_exists:
                print("✅ Table 'crm_analysis' EXISTS")
                
                # Get table structure
                result = await session.execute(
                    text("DESCRIBE crm_analysis")
                )
                columns = result.fetchall()
                
                print("\n📋 Table Structure:")
                print("-" * 80)
                print(f"{'Column':<30} {'Type':<20} {'Null':<10} {'Key':<10} {'Default':<10}")
                print("-" * 80)
                for col in columns:
                    print(f"{col[0]:<30} {col[1]:<20} {col[2]:<10} {col[3]:<10} {str(col[4] or ''):<10}")
                
                # Get row count
                result = await session.execute(text("SELECT COUNT(*) FROM crm_analysis"))
                row_count = result.scalar()
                print(f"\n📊 Total Rows: {row_count}")
                
            else:
                print("❌ Table 'crm_analysis' DOES NOT EXIST")
                print("\n💡 You need to create the table. The table should have these columns:")
                print("   - CUST_MOBILENO (VARCHAR(60), PRIMARY KEY)")
                print("   - CUSTOMER_NAME (VARCHAR(255))")
                print("   - FIRST_IN_DATE (DATE)")
                print("   - R_VALUE, F_VALUE, M_VALUE (INTEGER)")
                print("   - R_SCORE, F_SCORE, M_SCORE (INTEGER)")
                print("   - SEGMENT_MAP (VARCHAR(255))")
                print("   - NO_OF_ITEMS (INTEGER)")
                print("   - TOTAL_SALES (DECIMAL(53,2))")
                print("   - DAYS (INTEGER)")
                print("   - FIRST_YR_COUNT through FIFTH_YR_COUNT (INTEGER)")
                print("   - And other fields as defined in InvCrmAnalysis model")
                
        except Exception as e:
            print(f"❌ Error checking table: {e}")
            print(f"   Error type: {type(e).__name__}")


if __name__ == "__main__":
    asyncio.run(check_table_exists())

