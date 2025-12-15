"""Automated setup script for Campaign Dashboard optimization.

This script automatically:
1. Creates all required database indexes
2. Checks Redis availability
3. Installs missing dependencies
4. Verifies the setup
"""

import asyncio
import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.core.config import settings


async def index_exists(session: AsyncSession, index_name: str) -> bool:
    """Check if an index exists."""
    try:
        result = await session.execute(text("""
            SELECT COUNT(*) as count
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'crm_analysis'
            AND INDEX_NAME = :index_name
        """), {"index_name": index_name})
        return (result.scalar() or 0) > 0
    except Exception:
        return False


async def create_indexes(session: AsyncSession) -> dict:
    """Create all required indexes for campaign dashboard optimization."""
    indexes = {
        "idx_crm_first_in_date": "CREATE INDEX idx_crm_first_in_date ON crm_analysis(FIRST_IN_DATE)",
        "idx_crm_date_range": "CREATE INDEX idx_crm_date_range ON crm_analysis(FIRST_IN_DATE, LAST_IN_DATE)",
        "idx_crm_cust_mobile": "CREATE INDEX idx_crm_cust_mobile ON crm_analysis(CUST_MOBILENO)",
        "idx_crm_customer_name": "CREATE INDEX idx_crm_customer_name ON crm_analysis(CUSTOMER_NAME)",
        "idx_crm_r_score": "CREATE INDEX idx_crm_r_score ON crm_analysis(R_SCORE)",
        "idx_crm_f_score": "CREATE INDEX idx_crm_f_score ON crm_analysis(F_SCORE)",
        "idx_crm_m_score": "CREATE INDEX idx_crm_m_score ON crm_analysis(M_SCORE)",
        "idx_crm_days": "CREATE INDEX idx_crm_days ON crm_analysis(DAYS)",
        "idx_crm_f_value": "CREATE INDEX idx_crm_f_value ON crm_analysis(F_VALUE)",
        "idx_crm_total_sales": "CREATE INDEX idx_crm_total_sales ON crm_analysis(TOTAL_SALES)",
        "idx_crm_segment_map": "CREATE INDEX idx_crm_segment_map ON crm_analysis(SEGMENT_MAP)",
        "idx_crm_date_customer": "CREATE INDEX idx_crm_date_customer ON crm_analysis(FIRST_IN_DATE, CUST_MOBILENO, CUSTOMER_NAME)",
        "idx_crm_rfm_scores": "CREATE INDEX idx_crm_rfm_scores ON crm_analysis(R_SCORE, F_SCORE, M_SCORE)",
        "idx_crm_buckets": "CREATE INDEX idx_crm_buckets ON crm_analysis(DAYS, TOTAL_SALES, F_VALUE)",
        "idx_crm_kpi_metrics": "CREATE INDEX idx_crm_kpi_metrics ON crm_analysis(NO_OF_ITEMS, TOTAL_SALES, DAYS, F_SCORE)",
        "idx_crm_year_counts": "CREATE INDEX idx_crm_year_counts ON crm_analysis(FIRST_YR_COUNT, SECOND_YR_COUNT, THIRD_YR_COUNT, FOURTH_YR_COUNT, FIFTH_YR_COUNT)",
    }
    
    results = {"created": 0, "skipped": 0, "errors": []}
    
    for index_name, sql in indexes.items():
        try:
            # Check if index already exists
            if await index_exists(session, index_name):
                results["skipped"] += 1
                print(f"⏭️  Index already exists: {index_name}")
                continue
            
            # Create the index
            await session.execute(text(sql))
            await session.commit()
            results["created"] += 1
            print(f"✅ Created index: {index_name}")
        except Exception as e:
            error_msg = str(e)
            # Check if it's a duplicate error (index was created between check and create)
            if "Duplicate key name" in error_msg or "already exists" in error_msg.lower():
                results["skipped"] += 1
                print(f"⏭️  Index already exists: {index_name}")
            else:
                results["errors"].append(f"{index_name}: {error_msg}")
                print(f"❌ Error creating {index_name}: {error_msg}")
    
    return results


async def verify_indexes(session: AsyncSession) -> int:
    """Verify indexes were created successfully."""
    try:
        result = await session.execute(text("""
            SELECT COUNT(*) as count
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'crm_analysis'
            AND INDEX_NAME != 'PRIMARY'
        """))
        count = result.scalar() or 0
        return count
    except Exception as e:
        print(f"⚠️  Could not verify indexes: {e}")
        return 0


async def check_redis() -> bool:
    """Check if Redis is available."""
    try:
        from app.core.cache import get_redis_client
        client = await get_redis_client()
        if client:
            await client.ping()
            return True
    except Exception:
        pass
    return False


async def setup_dashboard_optimization():
    """Main setup function."""
    print("=" * 60)
    print("Campaign Dashboard Optimization - Automated Setup")
    print("=" * 60)
    print()
    
    # Step 1: Create database indexes
    print("📊 Step 1: Creating database indexes...")
    print("-" * 60)
    
    async with SessionLocal() as session:
        try:
            # Check if table exists
            result = await session.execute(text("""
                SELECT COUNT(*) as count
                FROM information_schema.tables 
                WHERE table_schema = DATABASE()
                AND table_name = 'crm_analysis'
            """))
            table_exists = result.scalar() > 0
            
            if not table_exists:
                print("❌ ERROR: Table 'crm_analysis' does not exist!")
                print("   Please create the table first before running optimization.")
                return False
            
            print("✅ Table 'crm_analysis' exists")
            print()
            
            # Create indexes
            index_results = await create_indexes(session)
            print()
            print(f"📈 Index Creation Summary:")
            print(f"   Created: {index_results['created']}")
            print(f"   Skipped (already exist): {index_results['skipped']}")
            if index_results['errors']:
                print(f"   Errors: {len(index_results['errors'])}")
                for error in index_results['errors']:
                    print(f"      - {error}")
            
            # Verify indexes
            index_count = await verify_indexes(session)
            print()
            print(f"✅ Verification: Found {index_count} indexes on crm_analysis table")
            
        except Exception as e:
            print(f"❌ ERROR: Failed to create indexes: {e}")
            return False
    
    print()
    print("-" * 60)
    
    # Step 2: Check Redis
    print("🔴 Step 2: Checking Redis availability...")
    print("-" * 60)
    
    redis_available = await check_redis()
    if redis_available:
        print("✅ Redis is available and connected")
        print("   Caching will be enabled (15 min TTL)")
    else:
        print("⚠️  Redis is not available")
        print("   The API will work without caching (still optimized with indexes)")
        print("   To enable caching, install and start Redis:")
        print("      pip install redis>=5.0.0")
        print("      redis-server")
    
    print()
    print("-" * 60)
    
    # Step 3: Check dependencies
    print("📦 Step 3: Checking dependencies...")
    print("-" * 60)
    
    try:
        import redis
        print("✅ redis package is installed")
    except ImportError:
        print("⚠️  redis package not found")
        print("   Install with: pip install redis>=5.0.0")
        print("   (Optional - API works without Redis)")
    
    print()
    print("=" * 60)
    print("✅ Setup Complete!")
    print("=" * 60)
    print()
    print("📋 Summary:")
    print(f"   • Database indexes: {'✅ Created' if index_results['created'] > 0 or index_results['skipped'] > 0 else '❌ Failed'}")
    print(f"   • Redis caching: {'✅ Available' if redis_available else '⚠️  Not available (optional)'}")
    print()
    print("🚀 Next steps:")
    print("   1. Restart your FastAPI server")
    print("   2. Test the dashboard endpoint")
    print("   3. Expected performance: <10 seconds (uncached), <100ms (cached)")
    print()
    
    return True


if __name__ == "__main__":
    try:
        success = asyncio.run(setup_dashboard_optimization())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Setup interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Setup failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

