"""Script to verify if indexes exist on crm_analysis_tcm table."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from app.core.db import SessionLocal


async def verify_indexes():
    """Verify all required indexes exist on crm_analysis_tcm table."""
    required_indexes = [
        "idx_crm_tcm_first_in_date",
        "idx_crm_tcm_date_range",
        "idx_crm_tcm_cust_mobile",
        "idx_crm_tcm_customer_name",
        "idx_crm_tcm_r_score",
        "idx_crm_tcm_f_score",
        "idx_crm_tcm_m_score",
        "idx_crm_tcm_days",
        "idx_crm_tcm_f_value",
        "idx_crm_tcm_total_sales",
        "idx_crm_tcm_segment_map",
        "idx_crm_tcm_date_customer",
        "idx_crm_tcm_rfm_scores",
        "idx_crm_tcm_buckets",
        "idx_crm_tcm_kpi_metrics",
        "idx_crm_tcm_year_counts",
    ]
    
    async with SessionLocal() as session:
        print("Verifying indexes on crm_analysis_tcm table...")
        print("=" * 60)
        
        # Get all existing indexes
        check_sql = text("""
            SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'crm_analysis_tcm'
            AND INDEX_NAME != 'PRIMARY'
            GROUP BY INDEX_NAME
            ORDER BY INDEX_NAME
        """)
        result = await session.execute(check_sql)
        existing_indexes = {row[0] for row in result.fetchall()}
        
        missing = []
        present = []
        
        for index_name in required_indexes:
            if index_name in existing_indexes:
                present.append(index_name)
                print(f"✅ {index_name} - EXISTS")
            else:
                missing.append(index_name)
                print(f"❌ {index_name} - MISSING")
        
        print("=" * 60)
        print(f"Summary: {len(present)}/{len(required_indexes)} indexes present")
        
        if missing:
            print(f"\n⚠️  WARNING: {len(missing)} indexes are missing!")
            print("This will significantly slow down dashboard queries.")
            print("\nTo create missing indexes, run:")
            print("  python scripts/create_tcm_indexes.py")
            print("\nOr use the SQL script:")
            print("  mysql -u username -p database_name < database_indexes_campaign_dashboard_tcm.sql")
            return False
        else:
            print("\n✅ All required indexes are present!")
            print("Dashboard queries should be fast.")
            return True


if __name__ == "__main__":
    asyncio.run(verify_indexes())

