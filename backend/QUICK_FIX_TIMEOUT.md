# Quick Fix: Timeout Error

## Problem
Getting "timeout of 5000ms exceeded" error when loading dashboard.

## Solution

The timeout has been increased to 30 seconds. This is needed because:

1. **First Request**: Takes 3-10 seconds to build cache (even with indexes)
2. **Subsequent Requests**: Will be <100ms (served from cache)

## What Changed

- ✅ Frontend timeout increased from 5 seconds to 30 seconds
- ✅ This allows first request to complete (builds cache)
- ✅ All subsequent requests will be <100ms (cached)

## Why 30 Seconds?

- **With Indexes**: First request takes 3-10 seconds
- **Without Indexes**: First request would timeout (need to create indexes!)
- **With Cache**: Subsequent requests are <100ms

## Next Steps

### 1. Ensure Indexes Exist

```bash
cd backend
python scripts/create_tcm_indexes.py
```

### 2. Ensure Redis is Running (for <1 second loads)

**Windows:**
```powershell
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it:
# Option 1: Download from GitHub
# Option 2: Docker
docker run -d -p 6379:6379 --name redis redis:latest
```

**Linux/Mac:**
```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it:
sudo systemctl start redis  # Linux
brew services start redis  # macOS
```

### 3. Restart Server

```bash
cd backend
uvicorn app.main:app --reload
```

## Expected Behavior

1. **First Request**: 3-10 seconds (builds cache)
2. **Second Request**: <100ms (served from cache)
3. **All Future Requests**: <100ms (cached)

## If Still Getting Timeouts

### Check 1: Indexes Exist?
```sql
SHOW INDEX FROM crm_analysis_tcm;
```
Should see 16 indexes. If not, create them:
```bash
python scripts/create_tcm_indexes.py
```

### Check 2: Redis Running?
```bash
redis-cli ping
```
Should return `PONG`. If not, start Redis.

### Check 3: Database Connection?
Check your `.env` file has correct database credentials.

### Check 4: Table Has Data?
```sql
SELECT COUNT(*) FROM crm_analysis_tcm;
```
If table is empty or very large without indexes, queries will be slow.

## Summary

- ✅ Timeout increased to 30 seconds (allows first request)
- ✅ First request: 3-10 seconds (builds cache)
- ✅ Subsequent requests: <100ms (cached)
- ⚠️ If still timing out: Check indexes and Redis

