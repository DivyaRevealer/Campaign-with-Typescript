"""Check R_SCORE distribution."""
import sys, pathlib, asyncio
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis

async def check():
    async with SessionLocal() as s:
        r_query = select(
            InvCrmAnalysis.r_score,
            func.count(InvCrmAnalysis.cust_mobileno).label('count')
        ).group_by(InvCrmAnalysis.r_score).order_by(InvCrmAnalysis.r_score)
        results = (await s.execute(r_query)).all()
        print('R_SCORE Distribution:')
        for r in results:
            print(f'  R_SCORE={r.r_score}: {r.count} customers')
        
        # Check how many have R_SCORE = 5
        r5_query = select(func.count(InvCrmAnalysis.cust_mobileno)).where(InvCrmAnalysis.r_score == 5)
        r5_count = (await s.execute(r5_query)).scalar()
        print(f'\nR_SCORE = 5 (Most Recent): {r5_count} customers')
        
        # Check how many have R_SCORE >= 4
        r4plus_query = select(func.count(InvCrmAnalysis.cust_mobileno)).where(InvCrmAnalysis.r_score >= 4)
        r4plus_count = (await s.execute(r4plus_query)).scalar()
        print(f'R_SCORE >= 4: {r4plus_count} customers')

asyncio.run(check())

