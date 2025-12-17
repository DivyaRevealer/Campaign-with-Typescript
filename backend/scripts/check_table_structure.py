"""Script to check if crm_analysis_tcm is a table or view and check for any limits."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from app.core.db import SessionLocal


async def check_table_structure():
    """Check if crm_analysis_tcm is a table or view and get its definition."""
    async with SessionLocal() as session:
        print("=" * 80)
        print("Checking crm_analysis_tcm structure...")
        print("=" * 80)
        
        # Check if it's a table or view
        check_type_query = text("""
            SELECT 
                TABLE_TYPE,
                TABLE_NAME
            FROM 
                INFORMATION_SCHEMA.TABLES
            WHERE 
                TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'crm_analysis_tcm'
        """)
        
        result = await session.execute(check_type_query)
        table_info = result.first()
        
        if not table_info:
            print("❌ ERROR: Table/view 'crm_analysis_tcm' not found!")
            return
        
        table_type = table_info.TABLE_TYPE
        print(f"\n✅ Found: {table_info.TABLE_NAME} (Type: {table_type})")
        
        # Get row count
        count_query = text("SELECT COUNT(*) as total FROM crm_analysis_tcm")
        count_result = await session.execute(count_query)
        total_rows = count_result.scalar()
        print(f"\n📊 Total rows in crm_analysis_tcm: {total_rows:,}")
        
        # If it's a view, get its definition
        if table_type == "VIEW":
            print("\n⚠️  WARNING: crm_analysis_tcm is a VIEW, not a TABLE!")
            print("Checking view definition for any LIMIT/TOP clauses...")
            
            view_def_query = text("""
                SELECT 
                    VIEW_DEFINITION
                FROM 
                    INFORMATION_SCHEMA.VIEWS
                WHERE 
                    TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'crm_analysis_tcm'
            """)
            
            view_result = await session.execute(view_def_query)
            view_def = view_result.scalar()
            
            if view_def:
                view_def_upper = view_def.upper()
                print("\n📝 View Definition (first 1000 chars):")
                print("-" * 80)
                print(view_def[:1000])
                print("-" * 80)
                
                # Check for common limit clauses
                if "TOP 10000" in view_def_upper or "TOP (10000)" in view_def_upper:
                    print("\n❌ FOUND: View contains 'TOP 10000' clause!")
                    print("   This is limiting results to 10,000 rows.")
                elif "LIMIT 10000" in view_def_upper or "LIMIT (10000)" in view_def_upper:
                    print("\n❌ FOUND: View contains 'LIMIT 10000' clause!")
                    print("   This is limiting results to 10,000 rows.")
                elif "ROWNUM" in view_def_upper and "10000" in view_def_upper:
                    print("\n❌ FOUND: View contains ROWNUM <= 10000 clause!")
                    print("   This is limiting results to 10,000 rows.")
                else:
                    print("\n✅ No obvious LIMIT/TOP 10000 clause found in view definition.")
                    print("   But the view might still have a limit - check the full definition.")
        else:
            print("\n✅ crm_analysis_tcm is a TABLE (not a view)")
            print("   No view-level limits should apply.")
        
        # Check for any triggers or constraints that might limit data
        print("\n" + "=" * 80)
        print("Summary:")
        print("=" * 80)
        print(f"Type: {table_type}")
        print(f"Total Rows: {total_rows:,}")
        
        if total_rows == 10000:
            print("\n⚠️  WARNING: Table/view has exactly 10,000 rows!")
            print("   This might indicate a limit in the source or view definition.")
        elif total_rows < 10000:
            print(f"\nℹ️  Table/view has {total_rows:,} rows (less than 10,000)")
        else:
            print(f"\n✅ Table/view has {total_rows:,} rows (more than 10,000)")


if __name__ == "__main__":
    asyncio.run(check_table_structure())

