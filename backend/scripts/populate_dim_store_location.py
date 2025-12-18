"""
Script to populate dim_store_location from crm_analysis_tcm fact table.
Run this after creating the dimension table.

Usage:
    python -m backend.scripts.populate_dim_store_location
"""

import asyncio
import sys
from pathlib import Path

# Add backend directory to path to import app modules
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir.parent))

from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.dim_store_location import DimStoreLocation


async def populate_dim_store_location():
    """Populate dim_store_location from crm_analysis_tcm fact table."""
    
    async with SessionLocal() as session:
        try:
            print("🟢 [Dimension Table] Starting population from fact table...")
            
            # Check if table exists and get current count
            try:
                count_query = select(func.count(DimStoreLocation.id))
                result = await session.execute(count_query)
                current_count = result.scalar() or 0
                print(f"📊 Current records in dim_store_location: {current_count}")
            except Exception as e:
                print(f"⚠️ [Dimension Table] Table might not exist yet: {str(e)}")
                print("   Please run database_dim_store_location.sql first to create the table.")
                return
            
            # Populate from fact table
            print("\n📊 Populating dim_store_location from crm_analysis_tcm...")
            populate_query = text("""
                INSERT INTO dim_store_location (store_name, city, state, is_active)
                SELECT DISTINCT
                    TRIM(LAST_IN_STORE_NAME) as store_name,
                    TRIM(LAST_IN_STORE_CITY) as city,
                    TRIM(LAST_IN_STORE_STATE) as state,
                    TRUE as is_active
                FROM crm_analysis_tcm
                WHERE LAST_IN_STORE_NAME IS NOT NULL
                  AND TRIM(LAST_IN_STORE_NAME) != ''
                  AND TRIM(LAST_IN_STORE_NAME) != 'NULL'
                  AND LAST_IN_STORE_CITY IS NOT NULL
                  AND TRIM(LAST_IN_STORE_CITY) != ''
                  AND TRIM(LAST_IN_STORE_CITY) != 'NULL'
                  AND LAST_IN_STORE_STATE IS NOT NULL
                  AND TRIM(LAST_IN_STORE_STATE) != ''
                  AND TRIM(LAST_IN_STORE_STATE) != 'NULL'
                ON DUPLICATE KEY UPDATE
                    store_name = VALUES(store_name),
                    city = VALUES(city),
                    state = VALUES(state),
                    updated_at = CURRENT_TIMESTAMP
            """)
            
            result = await session.execute(populate_query)
            await session.commit()
            rows_affected = result.rowcount if hasattr(result, 'rowcount') else 0
            
            # Get final counts
            final_count_query = select(func.count(DimStoreLocation.id))
            final_result = await session.execute(final_count_query)
            final_count = final_result.scalar() or 0
            
            # Get unique counts
            states_query = select(func.count(func.distinct(DimStoreLocation.state)))
            cities_query = select(func.count(func.distinct(DimStoreLocation.city)))
            stores_query = select(func.count(func.distinct(DimStoreLocation.store_name)))
            
            states_result = await session.execute(states_query)
            cities_result = await session.execute(cities_query)
            stores_result = await session.execute(stores_query)
            
            states_count = states_result.scalar() or 0
            cities_count = cities_result.scalar() or 0
            stores_count = stores_result.scalar() or 0
            
            # Summary
            print("\n" + "="*60)
            print("✅ [Dimension Table] Population completed successfully!")
            print(f"   - Total locations: {final_count}")
            print(f"   - Unique states: {states_count}")
            print(f"   - Unique cities: {cities_count}")
            print(f"   - Unique stores: {stores_count}")
            print("="*60)
            print("\n💡 Next steps:")
            print("   1. Restart the backend server to clear cache")
            print("   2. Hard refresh the frontend (Ctrl+Shift+R)")
            print("   3. The filter dropdowns should now be populated")
            
        except Exception as e:
            await session.rollback()
            print(f"\n❌ [Dimension Table] Error: {str(e)}")
            print(f"   Error type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            raise


if __name__ == "__main__":
    asyncio.run(populate_dim_store_location())

