"""Debug script to check what types the database returns for R/F/M scores."""

import sys
import pathlib
import asyncio

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.db import SessionLocal
from app.models.inv_crm_analysis import InvCrmAnalysis

async def debug():
    """Check what types the database returns."""
    async with SessionLocal() as session:
        print("=" * 80)
        print("DEBUGGING OPTIONS ENDPOINT - DATABASE TYPES")
        print("=" * 80)
        
        # Query R scores
        print("\n1. R_SCORE Query:")
        r_query = select(InvCrmAnalysis.r_score).distinct().where(
            InvCrmAnalysis.r_score.isnot(None)
        ).order_by(InvCrmAnalysis.r_score).limit(10)
        r_results = (await session.execute(r_query)).scalars().all()
        
        print(f"   Found {len(r_results)} distinct R scores")
        for i, r in enumerate(r_results[:5]):
            print(f"   [{i}] Value: {r!r}, Type: {type(r).__name__}, isinstance(int): {isinstance(r, int)}")
            try:
                converted = int(r)
                print(f"       -> int(r): {converted!r}, Type: {type(converted).__name__}, isinstance(int): {isinstance(converted, int)}")
            except Exception as e:
                print(f"       -> int(r) FAILED: {e}")
        
        # Query F scores
        print("\n2. F_SCORE Query:")
        f_query = select(InvCrmAnalysis.f_score).distinct().where(
            InvCrmAnalysis.f_score.isnot(None)
        ).order_by(InvCrmAnalysis.f_score).limit(10)
        f_results = (await session.execute(f_query)).scalars().all()
        
        print(f"   Found {len(f_results)} distinct F scores")
        for i, f in enumerate(f_results[:5]):
            print(f"   [{i}] Value: {f!r}, Type: {type(f).__name__}, isinstance(int): {isinstance(f, int)}")
            try:
                converted = int(f)
                print(f"       -> int(f): {converted!r}, Type: {type(converted).__name__}, isinstance(int): {isinstance(converted, int)}")
            except Exception as e:
                print(f"       -> int(f) FAILED: {e}")
        
        # Query M scores
        print("\n3. M_SCORE Query:")
        m_query = select(InvCrmAnalysis.m_score).distinct().where(
            InvCrmAnalysis.m_score.isnot(None)
        ).order_by(InvCrmAnalysis.m_score).limit(10)
        m_results = (await session.execute(m_query)).scalars().all()
        
        print(f"   Found {len(m_results)} distinct M scores")
        for i, m in enumerate(m_results[:5]):
            print(f"   [{i}] Value: {m!r}, Type: {type(m).__name__}, isinstance(int): {isinstance(m, int)}")
            try:
                converted = int(m)
                print(f"       -> int(m): {converted!r}, Type: {type(converted).__name__}, isinstance(int): {isinstance(converted, int)}")
            except Exception as e:
                print(f"       -> int(m) FAILED: {e}")
        
        # Test the conversion logic
        print("\n4. Testing Conversion Logic:")
        r_scores_converted = []
        for r in r_results:
            if r is not None:
                try:
                    int_val = int(r)
                    if isinstance(int_val, int) and type(int_val) is int:
                        r_scores_converted.append(int_val)
                except (ValueError, TypeError, AttributeError) as e:
                    print(f"   Failed to convert {r!r} (type: {type(r).__name__}): {e}")
        
        print(f"   Converted R scores: {r_scores_converted}")
        print(f"   Types: {[type(x).__name__ for x in r_scores_converted]}")
        
        # Check if there are any None values
        print("\n5. Checking for None values:")
        all_r = (await session.execute(select(InvCrmAnalysis.r_score).limit(100))).scalars().all()
        none_count = sum(1 for r in all_r if r is None)
        print(f"   None values in first 100 R_SCORE rows: {none_count}")
        
        # Check brand hierarchy
        print("\n6. Checking Brand Hierarchy:")
        try:
            from app.models.inv_campaign_brand_filter import InvCampaignBrandFilter
            brand_query = select(
                InvCampaignBrandFilter.brand,
                InvCampaignBrandFilter.section,
            ).limit(5)
            brand_results = (await session.execute(brand_query)).all()
            print(f"   Found {len(brand_results)} brand rows")
            for i, row in enumerate(brand_results):
                print(f"   [{i}] brand: {row[0]!r} (type: {type(row[0]).__name__}), section: {row[1]!r} (type: {type(row[1]).__name__})")
        except Exception as e:
            print(f"   Error querying brand hierarchy: {e}")

if __name__ == "__main__":
    asyncio.run(debug())

