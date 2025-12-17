"""Script to clear campaign dashboard cache."""

import asyncio
import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from app.core.cache import clear_cache_pattern


async def clear_cache():
    """Clear all campaign dashboard cache entries."""
    print("Clearing campaign dashboard cache...")
    count = await clear_cache_pattern("campaign_dashboard:*")
    print(f"✅ Cleared {count} cache entries")
    
    # Also clear filter cache
    count2 = await clear_cache_pattern("campaign_dashboard_filters:*")
    print(f"✅ Cleared {count2} filter cache entries")
    
    print("\n🎉 Cache cleared! The dashboard will now fetch fresh data from crm_analysis_tcm table.")


if __name__ == "__main__":
    asyncio.run(clear_cache())

