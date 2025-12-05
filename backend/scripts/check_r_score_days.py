"""Check R_SCORE with DAYS=0."""
import sys, pathlib, asyncio
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, and_
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis

async def check():
    async with SessionLocal() as s:
        # Check R_SCORE = 5 AND DAYS = 0
        r5_days0 = select(func.count(InvCrmAnalysis.cust_mobileno)).where(
            and_(InvCrmAnalysis.r_score == 5, InvCrmAnalysis.days == 0)
        )
        count = (await s.execute(r5_days0)).scalar()
        print(f'R_SCORE=5 AND DAYS=0: {count} customers')
        
        # Check R_SCORE = 5 AND DAYS <= 30
        r5_days30 = select(func.count(InvCrmAnalysis.cust_mobileno)).where(
            and_(InvCrmAnalysis.r_score == 5, InvCrmAnalysis.days <= 30)
        )
        count2 = (await s.execute(r5_days30)).scalar()
        print(f'R_SCORE=5 AND DAYS<=30: {count2} customers')
        
        # Check DAYS distribution
        days_query = select(
            InvCrmAnalysis.days,
            func.count(InvCrmAnalysis.cust_mobileno).label('count')
        ).group_by(InvCrmAnalysis.days).order_by(InvCrmAnalysis.days).limit(10)
        days_results = (await s.execute(days_query)).all()
        print('\nDAYS distribution (first 10):')
        for r in days_results:
            print(f'  DAYS={r.days}: {r.count} customers')

asyncio.run(check())

