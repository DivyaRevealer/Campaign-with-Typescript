"""Script to create indexes on crm_analysis_tcm table for performance optimization."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from app.core.db import SessionLocal


async def create_indexes():
    """Create all required indexes on crm_analysis_tcm table."""
    indexes = [
        ("idx_crm_tcm_first_in_date", "CREATE INDEX idx_crm_tcm_first_in_date ON crm_analysis_tcm(FIRST_IN_DATE)"),
        ("idx_crm_tcm_date_range", "CREATE INDEX idx_crm_tcm_date_range ON crm_analysis_tcm(FIRST_IN_DATE, LAST_IN_DATE)"),
        ("idx_crm_tcm_cust_mobile", "CREATE INDEX idx_crm_tcm_cust_mobile ON crm_analysis_tcm(CUST_MOBILENO)"),
        ("idx_crm_tcm_customer_name", "CREATE INDEX idx_crm_tcm_customer_name ON crm_analysis_tcm(CUSTOMER_NAME)"),
        ("idx_crm_tcm_r_score", "CREATE INDEX idx_crm_tcm_r_score ON crm_analysis_tcm(R_SCORE)"),
        ("idx_crm_tcm_f_score", "CREATE INDEX idx_crm_tcm_f_score ON crm_analysis_tcm(F_SCORE)"),
        ("idx_crm_tcm_m_score", "CREATE INDEX idx_crm_tcm_m_score ON crm_analysis_tcm(M_SCORE)"),
        ("idx_crm_tcm_days", "CREATE INDEX idx_crm_tcm_days ON crm_analysis_tcm(DAYS)"),
        ("idx_crm_tcm_f_value", "CREATE INDEX idx_crm_tcm_f_value ON crm_analysis_tcm(F_VALUE)"),
        ("idx_crm_tcm_total_sales", "CREATE INDEX idx_crm_tcm_total_sales ON crm_analysis_tcm(TOTAL_SALES)"),
        ("idx_crm_tcm_segment_map", "CREATE INDEX idx_crm_tcm_segment_map ON crm_analysis_tcm(SEGMENT_MAP)"),
        ("idx_crm_tcm_date_customer", "CREATE INDEX idx_crm_tcm_date_customer ON crm_analysis_tcm(FIRST_IN_DATE, CUST_MOBILENO, CUSTOMER_NAME)"),
        ("idx_crm_tcm_rfm_scores", "CREATE INDEX idx_crm_tcm_rfm_scores ON crm_analysis_tcm(R_SCORE, F_SCORE, M_SCORE)"),
        ("idx_crm_tcm_buckets", "CREATE INDEX idx_crm_tcm_buckets ON crm_analysis_tcm(DAYS, TOTAL_SALES, F_VALUE)"),
        ("idx_crm_tcm_kpi_metrics", "CREATE INDEX idx_crm_tcm_kpi_metrics ON crm_analysis_tcm(NO_OF_ITEMS, TOTAL_SALES, DAYS, F_SCORE)"),
        ("idx_crm_tcm_year_counts", "CREATE INDEX idx_crm_tcm_year_counts ON crm_analysis_tcm(FIRST_YR_COUNT, SECOND_YR_COUNT, THIRD_YR_COUNT, FOURTH_YR_COUNT, FIFTH_YR_COUNT)"),
    ]
    
    async with SessionLocal() as session:
        created = 0
        skipped = 0
        errors = []
        
        print("Creating indexes on crm_analysis_tcm table...")
        print("=" * 60)
        
        for index_name, sql in indexes:
            try:
                # Check if index already exists
                check_sql = text("""
                    SELECT COUNT(*) as count
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'crm_analysis_tcm'
                    AND INDEX_NAME = :index_name
                """)
                result = await session.execute(check_sql, {"index_name": index_name})
                exists = result.scalar() > 0
                
                if exists:
                    print(f"⏭️  {index_name} - Already exists, skipping")
                    skipped += 1
                else:
                    await session.execute(text(sql))
                    await session.commit()
                    print(f"✅ {index_name} - Created successfully")
                    created += 1
            except Exception as e:
                error_msg = str(e)
                # Check if it's a "duplicate key" error (index already exists)
                if "Duplicate key name" in error_msg or "already exists" in error_msg.lower():
                    print(f"⏭️  {index_name} - Already exists, skipping")
                    skipped += 1
                else:
                    print(f"❌ {index_name} - Error: {error_msg}")
                    errors.append((index_name, error_msg))
                    await session.rollback()
        
        print("=" * 60)
        print(f"\n📊 Summary:")
        print(f"   ✅ Created: {created}")
        print(f"   ⏭️  Skipped: {skipped}")
        if errors:
            print(f"   ❌ Errors: {len(errors)}")
            for index_name, error_msg in errors:
                print(f"      - {index_name}: {error_msg}")
        
        if created > 0:
            print(f"\n🎉 Successfully created {created} indexes!")
            print("   The dashboard should now load much faster (under 10 seconds).")
        elif skipped == len(indexes):
            print(f"\n✅ All indexes already exist!")
        else:
            print(f"\n⚠️  Some indexes could not be created. Check errors above.")


if __name__ == "__main__":
    asyncio.run(create_indexes())

