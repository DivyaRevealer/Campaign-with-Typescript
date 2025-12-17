# Refresh Dashboard with New crm_analysis_tcm Table Data

## Problem
Dashboard is showing old data from `crm_analysis` table instead of new data from `crm_analysis_tcm` table.

## Solution: Clear Cache and Restart

The dashboard is using the new table (`crm_analysis_tcm`), but Redis cache still has old data from the previous table.

### Step 1: Clear Redis Cache

**Option A: Using Python Script (Recommended)**
```bash
cd backend
python scripts/clear_dashboard_cache.py
```

**Option B: Using Redis CLI**
```bash
# Connect to Redis
redis-cli

# Clear all dashboard cache
KEYS campaign_dashboard:*
# Then delete each key, or:
DEL campaign_dashboard:*
DEL campaign_dashboard_filters:*

# Or clear all cache (be careful!)
FLUSHDB
```

**Option C: If Redis is not running**
- Just restart the server (cache will be empty)

### Step 2: Restart Your Server

```bash
cd backend
# Stop current server (Ctrl+C)
# Then restart
uvicorn app.main:app --reload
```

### Step 3: Verify Data is from New Table

After clearing cache and restarting:

1. **Open browser DevTools** → Network tab
2. **Refresh the dashboard page**
3. **Check the API response** - should show data from `crm_analysis_tcm`
4. **Compare values** - should match what's in `crm_analysis_tcm` table

### Step 4: Verify Table is Being Used

Check server logs when you load the dashboard. You should see queries against `crm_analysis_tcm` table.

Or check database directly:
```sql
-- Check data in new table
SELECT COUNT(*) FROM crm_analysis_tcm;

-- Compare with old table (if it still exists)
SELECT COUNT(*) FROM crm_analysis;
```

## Why This Happens

1. **Cache stores old data**: Redis cache has data from previous `crm_analysis` table
2. **Cache TTL is 1 hour**: Cache serves old data for up to 1 hour
3. **Stale cache**: Even stale cache (2 hours) might have old data

## Quick Fix Summary

```bash
# 1. Clear cache
cd backend
python scripts/clear_dashboard_cache.py

# 2. Restart server
uvicorn app.main:app --reload

# 3. Refresh browser (hard refresh: Ctrl+Shift+R)
```

## Verification Checklist

- [ ] Cache cleared (ran clear script or Redis FLUSHDB)
- [ ] Server restarted
- [ ] Browser refreshed (hard refresh)
- [ ] Data matches `crm_analysis_tcm` table
- [ ] No more old data showing

## If Still Showing Old Data

1. **Check if both tables exist:**
   ```sql
   SHOW TABLES LIKE 'crm_analysis%';
   ```

2. **Verify code is using correct table:**
   ```bash
   grep -r "InvCrmAnalysisTcm" backend/app/api/routes/campaign_dashboard_optimized.py
   ```
   Should show `InvCrmAnalysisTcm` (not `InvCrmAnalysis`)

3. **Check server logs:**
   - Look for SQL queries
   - Should see `FROM crm_analysis_tcm` not `FROM crm_analysis`

4. **Force clear all cache:**
   ```bash
   redis-cli FLUSHDB
   ```

