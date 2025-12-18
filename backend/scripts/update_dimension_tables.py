"""
Incremental update script for dimension tables.
This can be run periodically (daily/weekly) to sync new states/cities/stores from fact table.

The script uses INSERT ... ON DUPLICATE KEY UPDATE, so it's safe to run multiple times.
It only adds new records that don't exist yet.

Usage:
    python -m backend.scripts.update_dimension_tables
    
Can be scheduled via:
    - Cron (Linux/Mac)
    - Task Scheduler (Windows)
    - CI/CD pipeline
    - Database event scheduler
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.dim_state import DimState
from app.models.dim_city import DimCity
from app.models.dim_store import DimStore


async def update_dimension_tables():
    """
    Incrementally update dimension tables with new states/cities/stores from fact table.
    Safe to run multiple times - only adds new records.
    """
    
    async with SessionLocal() as session:
        try:
            print(f"🟢 [Dimension Update] Starting incremental update at {datetime.now()}")
            
            # Get current counts
            states_before = await session.execute(select(func.count(DimState.id)))
            cities_before = await session.execute(select(func.count(DimCity.id)))
            stores_before = await session.execute(select(func.count(DimStore.id)))
            states_before_count = states_before.scalar() or 0
            cities_before_count = cities_before.scalar() or 0
            stores_before_count = stores_before.scalar() or 0
            
            print(f"📊 Current counts: {states_before_count} states, {cities_before_count} cities, {stores_before_count} stores")
            
            # Step 1: Update States (only new ones)
            print("\n📊 Step 1: Updating dim_state...")
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
            result = await session.execute(states_query)
            await session.commit()
            states_added = result.rowcount if hasattr(result, 'rowcount') else 0
            
            # Step 2: Update Cities (only new ones)
            print("📊 Step 2: Updating dim_city...")
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
            result = await session.execute(cities_query)
            await session.commit()
            cities_added = result.rowcount if hasattr(result, 'rowcount') else 0
            
            # Step 3: Update Stores (only new ones)
            print("📊 Step 3: Updating dim_store...")
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
            result = await session.execute(stores_query)
            await session.commit()
            stores_added = result.rowcount if hasattr(result, 'rowcount') else 0
            
            # Get final counts
            states_after = await session.execute(select(func.count(DimState.id)))
            cities_after = await session.execute(select(func.count(DimCity.id)))
            stores_after = await session.execute(select(func.count(DimStore.id)))
            states_after_count = states_after.scalar() or 0
            cities_after_count = cities_after.scalar() or 0
            stores_after_count = stores_after.scalar() or 0
            
            # Summary
            print("\n" + "="*60)
            print("✅ [Dimension Update] Update completed!")
            print(f"   States: {states_before_count} → {states_after_count} (+{states_after_count - states_before_count})")
            print(f"   Cities: {cities_before_count} → {cities_after_count} (+{cities_after_count - cities_before_count})")
            print(f"   Stores: {stores_before_count} → {stores_after_count} (+{stores_after_count - stores_before_count})")
            print("="*60)
            
            # Clear cache hint
            print("\n💡 Note: Backend cache will auto-refresh within 1 hour.")
            print("   To force immediate refresh, restart the backend server.")
            
        except Exception as e:
            await session.rollback()
            print(f"\n❌ [Dimension Update] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            raise


if __name__ == "__main__":
    asyncio.run(update_dimension_tables())

