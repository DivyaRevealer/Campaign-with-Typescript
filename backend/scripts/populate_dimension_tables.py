"""
Script to populate dimension tables (dim_state, dim_city, dim_store) from fact table.
Run this after creating the dimension tables.

Usage:
    python -m backend.scripts.populate_dimension_tables
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.dim_state import DimState
from app.models.dim_city import DimCity
from app.models.dim_store import DimStore


async def populate_dimension_tables():
    """Populate dimension tables from crm_analysis_tcm fact table."""
    
    async with SessionLocal() as session:
        try:
            print("🟢 [Dimension Tables] Starting population from fact table...")
            
            # Step 1: Populate States
            print("\n📊 Step 1: Populating dim_state...")
            states_query = text("""
                INSERT INTO dim_state (code, name, is_active)
                SELECT DISTINCT
                    UPPER(TRIM(REPLACE(REPLACE(LAST_IN_STORE_STATE, ' ', '_'), '-', '_'))) as code,
                    TRIM(LAST_IN_STORE_STATE) as name,
                    TRUE as is_active
                FROM crm_analysis_tcm
                WHERE LAST_IN_STORE_STATE IS NOT NULL
                  AND TRIM(LAST_IN_STORE_STATE) != ''
                  AND TRIM(LAST_IN_STORE_STATE) != 'NULL'
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    updated_at = CURRENT_TIMESTAMP
            """)
            await session.execute(states_query)
            await session.commit()
            
            # Count states
            states_count = await session.execute(select(DimState))
            states_count = len(states_count.scalars().all())
            print(f"✅ [Dimension Tables] Populated {states_count} states")
            
            # Step 2: Populate Cities
            print("\n📊 Step 2: Populating dim_city...")
            cities_query = text("""
                INSERT INTO dim_city (code, name, state_id, is_active)
                SELECT DISTINCT
                    UPPER(TRIM(REPLACE(REPLACE(REPLACE(tcm.LAST_IN_STORE_CITY, ' ', '_'), '-', '_'), '/', '_'))) as code,
                    TRIM(tcm.LAST_IN_STORE_CITY) as name,
                    ds.id as state_id,
                    TRUE as is_active
                FROM crm_analysis_tcm tcm
                INNER JOIN dim_state ds ON TRIM(tcm.LAST_IN_STORE_STATE) = ds.name
                WHERE tcm.LAST_IN_STORE_CITY IS NOT NULL
                  AND TRIM(tcm.LAST_IN_STORE_CITY) != ''
                  AND TRIM(tcm.LAST_IN_STORE_CITY) != 'NULL'
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    state_id = VALUES(state_id),
                    updated_at = CURRENT_TIMESTAMP
            """)
            await session.execute(cities_query)
            await session.commit()
            
            # Count cities
            cities_count = await session.execute(select(DimCity))
            cities_count = len(cities_count.scalars().all())
            print(f"✅ [Dimension Tables] Populated {cities_count} cities")
            
            # Step 3: Populate Stores
            print("\n📊 Step 3: Populating dim_store...")
            stores_query = text("""
                INSERT INTO dim_store (code, name, city_id, state_id, is_active)
                SELECT DISTINCT
                    UPPER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(tcm.LAST_IN_STORE_NAME, ' ', '_'), '-', '_'), '/', '_'), '(', '_'))) as code,
                    TRIM(tcm.LAST_IN_STORE_NAME) as name,
                    dc.id as city_id,
                    ds.id as state_id,
                    TRUE as is_active
                FROM crm_analysis_tcm tcm
                INNER JOIN dim_state ds ON TRIM(tcm.LAST_IN_STORE_STATE) = ds.name
                INNER JOIN dim_city dc ON TRIM(tcm.LAST_IN_STORE_CITY) = dc.name AND dc.state_id = ds.id
                WHERE tcm.LAST_IN_STORE_NAME IS NOT NULL
                  AND TRIM(tcm.LAST_IN_STORE_NAME) != ''
                  AND TRIM(tcm.LAST_IN_STORE_NAME) != 'NULL'
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    city_id = VALUES(city_id),
                    state_id = VALUES(state_id),
                    updated_at = CURRENT_TIMESTAMP
            """)
            await session.execute(stores_query)
            await session.commit()
            
            # Count stores
            stores_count = await session.execute(select(DimStore))
            stores_count = len(stores_count.scalars().all())
            print(f"✅ [Dimension Tables] Populated {stores_count} stores")
            
            # Final summary
            print("\n" + "="*60)
            print("✅ [Dimension Tables] Population completed successfully!")
            print(f"   - States: {states_count}")
            print(f"   - Cities: {cities_count}")
            print(f"   - Stores: {stores_count}")
            print("="*60)
            print("\n💡 Next steps:")
            print("   1. Restart the backend server to clear cache")
            print("   2. Hard refresh the frontend (Ctrl+Shift+R)")
            print("   3. The filter dropdowns should now be populated")
            
        except Exception as e:
            await session.rollback()
            print(f"\n❌ [Dimension Tables] Error: {str(e)}")
            print(f"   Error type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            raise


if __name__ == "__main__":
    asyncio.run(populate_dimension_tables())

