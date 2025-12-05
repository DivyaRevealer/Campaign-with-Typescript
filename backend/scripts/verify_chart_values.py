"""Verify chart values match expected output."""
import sys, pathlib, asyncio
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, case, and_
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis

async def verify():
    """Verify chart values with no filters applied."""
    async with SessionLocal() as s:
        print("=" * 80)
        print("VERIFYING CHART VALUES (NO FILTERS)")
        print("=" * 80)
        
        # R Score - Current logic: R_SCORE == 5
        r_query = select(
            case(
                (InvCrmAnalysis.r_score == 5, "Bought Most Recently"),
                else_="Other"
            ).label("category"),
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by("category")
        r_results = (await s.execute(r_query)).all()
        print("\nR Score Distribution:")
        for r in r_results:
            print(f"  {r.category}: {r.count}")
        
        # Check if maybe it should be based on R_VALUE or DAYS
        print("\nAlternative R Score Calculations:")
        r_value_low = select(func.count(InvCrmAnalysis.cust_mobileno)).where(InvCrmAnalysis.r_value <= 30)
        count1 = (await s.execute(r_value_low)).scalar()
        print(f"  R_VALUE <= 30: {count1} customers")
        
        days_low = select(func.count(InvCrmAnalysis.cust_mobileno)).where(InvCrmAnalysis.days <= 30)
        count2 = (await s.execute(days_low)).scalar()
        print(f"  DAYS <= 30: {count2} customers")
        
        days_zero = select(func.count(InvCrmAnalysis.cust_mobileno)).where(InvCrmAnalysis.days == 0)
        count3 = (await s.execute(days_zero)).scalar()
        print(f"  DAYS == 0: {count3} customers")
        
        # F Score - should match
        print("\nF Score Distribution:")
        f_query = select(
            InvCrmAnalysis.f_score,
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by(InvCrmAnalysis.f_score).order_by(InvCrmAnalysis.f_score)
        f_results = (await s.execute(f_query)).all()
        score_labels = {1: "Most Rarest Visit", 2: "2", 3: "3", 4: "4", 5: "More Frequent Visit"}
        for r in f_results:
            label = score_labels.get(r.f_score, str(r.f_score))
            print(f"  {label}: {r.count}")
        
        # M Score - should match
        print("\nM Score Distribution:")
        m_query = select(
            InvCrmAnalysis.m_score,
            func.count(InvCrmAnalysis.cust_mobileno).label("count")
        ).group_by(InvCrmAnalysis.m_score).order_by(InvCrmAnalysis.m_score)
        m_results = (await s.execute(m_query)).all()
        for r in m_results:
            print(f"  Category {r.m_score}: {r.count}")

asyncio.run(verify())

