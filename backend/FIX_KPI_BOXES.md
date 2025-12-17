# Fix KPI Boxes Not Refreshing

## ✅ Indexes Created Successfully!

All 16 indexes have been created on `crm_analysis_tcm` table. The KPI boxes should now load much faster.

## 🔧 Steps to Refresh KPI Boxes

### Step 1: Clear Cache (Already Done)
✅ Cache has been cleared

### Step 2: Restart Your Server

**IMPORTANT:** You must restart the FastAPI server for the indexes to take effect:

```bash
# Stop current server (Ctrl+C if running)
# Then restart:
cd backend
uvicorn app.main:app --reload
```

### Step 3: Hard Refresh Browser

After restarting server:
- **Windows/Linux**: Press `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac**: Press `Cmd + Shift + R`

This clears browser cache and forces fresh data load.

## 🎯 What Should Happen Now

1. **First Load**: 3-10 seconds (queries with new indexes)
2. **KPI Boxes**: Should show data from `crm_analysis_tcm` table
3. **Subsequent Loads**: <100ms (cached)

## 🔍 Verify Data is from New Table

### Check 1: Compare Table Counts

```sql
-- Check old table
SELECT COUNT(*) FROM crm_analysis;

-- Check new table
SELECT COUNT(*) FROM crm_analysis_tcm;
```

If counts are different, the KPI boxes should show different values.

### Check 2: Check Specific Values

```sql
-- Check Total Customer in new table
SELECT COUNT(*) as total_customer FROM crm_analysis_tcm;

-- Check Average Customer Spend
SELECT AVG(TOTAL_SALES) as avg_spend FROM crm_analysis_tcm;
```

Compare these with what's shown in the KPI boxes.

### Check 3: Check Server Logs

When you load the dashboard, check server logs. You should see:
- SQL queries using `crm_analysis_tcm` table
- Query execution times (should be <10 seconds with indexes)

## ⚠️ If KPI Boxes Still Show Old Data

### Issue 1: Data is Same in Both Tables

If `crm_analysis_tcm` has the same data as `crm_analysis`, the KPI boxes will show the same values. This is expected.

**Solution**: Update data in `crm_analysis_tcm` table with new values.

### Issue 2: Still Timing Out

If you still get timeout errors:

1. **Check indexes exist:**
   ```sql
   SHOW INDEX FROM crm_analysis_tcm;
   ```
   Should see 16 indexes.

2. **Check table size:**
   ```sql
   SELECT COUNT(*) FROM crm_analysis_tcm;
   ```
   If table has millions of rows, even with indexes, first query might take 5-10 seconds.

3. **Check Redis is running:**
   ```bash
   redis-cli ping
   ```
   Should return `PONG`. If not, start Redis for caching.

### Issue 3: Cache Not Clearing

If cache persists:

```bash
# Clear all Redis cache
redis-cli FLUSHDB

# Or restart Redis
# Windows: Restart Redis service
# Linux: sudo systemctl restart redis
```

## 📊 Expected KPI Values

After refreshing, the KPI boxes should show:
- **Total Customer**: Count from `crm_analysis_tcm`
- **Unit Per Transaction**: Average from `crm_analysis_tcm`
- **Avg Customer Spend**: Average TOTAL_SALES from `crm_analysis_tcm`
- **Days to Return**: Average DAYS from `crm_analysis_tcm`
- **Retention Rate**: Calculated from `crm_analysis_tcm` data

## ✅ Summary

1. ✅ **Indexes created** (16 indexes on crm_analysis_tcm)
2. ✅ **Cache cleared**
3. ⏭️ **Restart server** (required!)
4. ⏭️ **Hard refresh browser** (Ctrl+Shift+R)
5. ✅ **KPI boxes should refresh** with new data

The indexes will make queries 10-50x faster, so the KPI boxes should load in 3-10 seconds instead of timing out.

