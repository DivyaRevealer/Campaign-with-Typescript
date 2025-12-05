"""Script to check actual dashboard values from database."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, case, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis


async def check_values():
    """Check actual values from database."""
    async with SessionLocal() as session:
        print("=" * 80)
        print("CHECKING DASHBOARD VALUES")
        print("=" * 80)
        
        # R Score Distribution
        print("\n1. R Score Distribution:")
        r_query = select(
            case(
                (InvCrmAnalysis.r_score >= 4, "Bought Most Recently"),
                else_="Other"
            ).label("category"),
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by("category")
        r_results = (await session.execute(r_query)).all()
        for r in r_results:
            print(f"   {r.category}: {r.count}")
        
        # F Score Distribution
        print("\n2. F Score Distribution:")
        f_query = select(
            InvCrmAnalysis.f_score,
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by(InvCrmAnalysis.f_score).order_by(InvCrmAnalysis.f_score)
        f_results = (await session.execute(f_query)).all()
        score_labels = {
            1: "Most Rarest Visit",
            2: "2",
            3: "3",
            4: "4",
            5: "More Frequent Visit",
        }
        for r in f_results:
            label = score_labels.get(r.f_score, str(r.f_score))
            print(f"   {label} (F_Score={r.f_score}): {r.count}")
        
        # M Score Distribution
        print("\n3. M Score Distribution:")
        m_query = select(
            InvCrmAnalysis.m_score,
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by(InvCrmAnalysis.m_score).order_by(InvCrmAnalysis.m_score)
        m_results = (await session.execute(m_query)).all()
        for r in m_results:
            print(f"   Category {r.m_score}: {r.count}")
        
        # R Value Bucket
        print("\n4. R Value Bucket (Days):")
        r_bucket_query = select(
            case(
                (InvCrmAnalysis.days <= 200, "1-200"),
                (InvCrmAnalysis.days <= 400, "200-400"),
                (InvCrmAnalysis.days <= 600, "400-600"),
                (InvCrmAnalysis.days <= 800, "600-800"),
                (InvCrmAnalysis.days <= 1000, "800-1000"),
                else_=">1000"
            ).label("bucket"),
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by("bucket")
        r_bucket_results = (await session.execute(r_bucket_query)).all()
        for r in r_bucket_results:
            print(f"   {r.bucket}: {r.count}")
        
        # Visits (F_VALUE)
        print("\n5. Visits (F_VALUE):")
        visits_query = select(
            InvCrmAnalysis.f_value,
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by(InvCrmAnalysis.f_value).order_by(InvCrmAnalysis.f_value)
        visits_results = (await session.execute(visits_query)).all()
        for r in visits_results:
            print(f"   {r.f_value} visits: {r.count}")
        
        # Value Bucket (TOTAL_SALES)
        print("\n6. Value Bucket (TOTAL_SALES):")
        value_query = select(
            case(
                (InvCrmAnalysis.total_sales <= 1000, "1-1000"),
                (InvCrmAnalysis.total_sales <= 2000, "1000-2000"),
                (InvCrmAnalysis.total_sales <= 3000, "2000-3000"),
                (InvCrmAnalysis.total_sales <= 4000, "3000-4000"),
                (InvCrmAnalysis.total_sales <= 5000, "4000-5000"),
                else_=">5000"
            ).label("bucket"),
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by("bucket")
        value_results = (await session.execute(value_query)).all()
        for r in value_results:
            print(f"   {r.bucket}: {r.count}")
        
        # Sample data check
        print("\n7. Sample Data Check:")
        sample_query = select(
            InvCrmAnalysis.cust_mobileno,
            InvCrmAnalysis.r_score,
            InvCrmAnalysis.f_score,
            InvCrmAnalysis.m_score,
            InvCrmAnalysis.days,
            InvCrmAnalysis.f_value,
            InvCrmAnalysis.total_sales
        ).limit(5)
        samples = (await session.execute(sample_query)).all()
        for s in samples:
            print(f"   Mobile: {s.cust_mobileno}, R={s.r_score}, F={s.f_score}, M={s.m_score}, Days={s.days}, F_Value={s.f_value}, Sales={s.total_sales}")


if __name__ == "__main__":
    asyncio.run(check_values())

