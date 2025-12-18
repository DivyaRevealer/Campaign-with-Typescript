# Dimension Tables Deployment Strategy

## When to Run Population Scripts

### Initial Deployment (One-Time Setup)
**Run once when deploying to a new server:**
```bash
python -m backend.scripts.populate_dimension_tables
```

### Ongoing Updates (Only if Needed)

**Question: Do you add new states/cities/stores daily?**

#### Scenario 1: Static Data (Most Common)
- **If states/cities/stores rarely change** (e.g., you have fixed locations)
- **Action**: Run population script **ONCE** during initial setup
- **No daily runs needed** ✅
- **When to update**: Only when you actually add new locations

#### Scenario 2: Dynamic Data
- **If new stores/cities are added frequently** (daily/weekly)
- **Action**: Schedule automatic updates (see below)

## Recommended Approach: Scheduled Updates

### Option 1: MySQL Event Scheduler (Recommended)

Create a MySQL event that runs daily/weekly:

```sql
-- Enable event scheduler (run once)
SET GLOBAL event_scheduler = ON;

-- Create daily update event
CREATE EVENT IF NOT EXISTS update_dimension_tables_daily
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR
DO
BEGIN
    -- Update states
    INSERT INTO dim_state (code, name, is_active)
    SELECT DISTINCT
        UPPER(TRIM(REPLACE(REPLACE(LAST_IN_STORE_STATE, ' ', '_'), '-', '_'))) as code,
        TRIM(LAST_IN_STORE_STATE) as name,
        TRUE as is_active
    FROM crm_analysis_tcm
    WHERE LAST_IN_STORE_STATE IS NOT NULL
      AND TRIM(LAST_IN_STORE_STATE) != ''
      AND TRIM(LAST_IN_STORE_STATE) != 'NULL'
    ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        updated_at = CURRENT_TIMESTAMP;
    
    -- Update cities (similar for cities and stores)
    -- ... (full SQL from populate_dimension_tables.sql)
END;
```

### Option 2: Cron Job (Linux/Mac)

Add to crontab (`crontab -e`):

```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/backend && python -m scripts.update_dimension_tables >> /var/log/dimension_update.log 2>&1
```

### Option 3: Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 2 AM
4. Action: Start a program
   - Program: `python`
   - Arguments: `-m backend.scripts.update_dimension_tables`
   - Start in: `C:\path\to\IMS\backend`

### Option 4: CI/CD Pipeline

Add to your deployment pipeline:

```yaml
# Example GitHub Actions
- name: Update Dimension Tables
  run: |
    cd backend
    python -m scripts.update_dimension_tables
```

## Performance Considerations

### Why Updates Are Fast
- **Small tables**: Dimension tables have <1000 rows each
- **Indexed**: All lookups use indexes
- **Incremental**: `ON DUPLICATE KEY UPDATE` only processes new records
- **Update time**: <1 second even with millions of fact table rows

### Cache Behavior
- Backend caches dimension data for **1 hour**
- New data appears within 1 hour automatically
- To force immediate refresh: Restart backend server

## Monitoring

### Check if Update is Needed

```sql
-- Compare dimension table counts with fact table distinct counts
SELECT 
    (SELECT COUNT(DISTINCT LAST_IN_STORE_STATE) FROM crm_analysis_tcm 
     WHERE LAST_IN_STORE_STATE IS NOT NULL AND TRIM(LAST_IN_STORE_STATE) != '') as fact_states,
    (SELECT COUNT(*) FROM dim_state) as dim_states,
    (SELECT COUNT(DISTINCT LAST_IN_STORE_CITY) FROM crm_analysis_tcm 
     WHERE LAST_IN_STORE_CITY IS NOT NULL AND TRIM(LAST_IN_STORE_CITY) != '') as fact_cities,
    (SELECT COUNT(*) FROM dim_city) as dim_cities,
    (SELECT COUNT(DISTINCT LAST_IN_STORE_NAME) FROM crm_analysis_tcm 
     WHERE LAST_IN_STORE_NAME IS NOT NULL AND TRIM(LAST_IN_STORE_NAME) != '') as fact_stores,
    (SELECT COUNT(*) FROM dim_store) as dim_stores;
```

If counts differ significantly, run the update script.

## Best Practice Recommendation

**For most deployments:**

1. ✅ Run `populate_dimension_tables.py` **once** during initial setup
2. ✅ Set up **weekly** scheduled update (not daily) - most locations don't change daily
3. ✅ Monitor counts monthly to verify sync
4. ✅ Manual update only when you know new locations were added

**Daily updates are only needed if:**
- You add new stores/cities every single day
- You have a high-volume data import process
- You need real-time accuracy (rare for location data)

## Summary

| Scenario | Frequency | Method |
|----------|-----------|--------|
| Initial setup | Once | `populate_dimension_tables.py` |
| Static locations | Never (or on-demand) | Manual when needed |
| Weekly new locations | Weekly | Scheduled job |
| Daily new locations | Daily | Scheduled job or event |
| Real-time critical | On data import | Trigger in ETL process |

**Most common case**: Run once during setup, then update manually when you add new locations. ✅

