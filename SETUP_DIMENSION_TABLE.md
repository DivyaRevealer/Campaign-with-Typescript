# Setup Dimension Table - Step by Step Guide

## Quick Start

### Option 1: Using MySQL Command Line (Recommended)

#### Step 1: Create the Dimension Table
```bash
mysql -u <your_username> -p <your_database_name> < backend/database_dim_store_location.sql
```

**Example:**
```bash
mysql -u root -p ims < backend/database_dim_store_location.sql
```

You will be prompted to enter your MySQL password.

#### Step 2: Populate the Dimension Table
```bash
mysql -u <your_username> -p <your_database_name> < backend/scripts/populate_dim_store_location.sql
```

**Example:**
```bash
mysql -u root -p ims < backend/scripts/populate_dim_store_location.sql
```

### Option 2: Using MySQL Workbench or phpMyAdmin

#### Step 1: Create the Dimension Table
1. Open MySQL Workbench or phpMyAdmin
2. Select your database
3. Open the file `backend/database_dim_store_location.sql`
4. Copy all contents
5. Paste into SQL query window
6. Execute the query

#### Step 2: Populate the Dimension Table
1. Open the file `backend/scripts/populate_dim_store_location.sql`
2. Copy all contents
3. Paste into SQL query window
4. Execute the query

### Option 3: Using Python Script (Alternative)

If you prefer to run it programmatically:

```python
import asyncio
from sqlalchemy import text
from app.core.db import SessionLocal

async def populate_dimension_table():
    async with SessionLocal() as session:
        # Read and execute the SQL file
        with open('backend/scripts/populate_dim_store_location.sql', 'r') as f:
            sql = f.read()
        
        await session.execute(text(sql))
        await session.commit()
        print("✅ Dimension table populated successfully!")

asyncio.run(populate_dimension_table())
```

## Verification

After populating, verify the data:

```sql
-- Check total records
SELECT COUNT(*) as total_locations FROM dim_store_location;

-- Check unique counts
SELECT 
    COUNT(DISTINCT state) as state_count,
    COUNT(DISTINCT city) as city_count,
    COUNT(DISTINCT store_name) as store_count
FROM dim_store_location;

-- Sample data
SELECT * FROM dim_store_location LIMIT 10;

-- Check by state
SELECT state, COUNT(*) as location_count 
FROM dim_store_location 
GROUP BY state 
ORDER BY location_count DESC 
LIMIT 10;
```

## Expected Results

- **Total Locations**: Should match number of unique store/city/state combinations in fact table
- **State Count**: Typically 20-50 states
- **City Count**: Typically 100-500 cities
- **Store Count**: Typically 1,000-5,000 stores

## Troubleshooting

### Error: "Table already exists"
**Solution**: The table already exists. You can either:
- Drop and recreate: `DROP TABLE IF EXISTS dim_store_location;` then run create script
- Or just run the populate script (it uses `INSERT ... ON DUPLICATE KEY UPDATE`)

### Error: "Access denied"
**Solution**: 
- Check your MySQL username and password
- Ensure user has CREATE and INSERT permissions
- Try: `mysql -u root -p` (if you have root access)

### Error: "Unknown database"
**Solution**: 
- Verify database name is correct
- Create database first: `CREATE DATABASE <database_name>;`

### No data populated
**Solution**:
- Check that `crm_analysis_tcm` table has data
- Verify column names match: `LAST_IN_STORE_STATE`, `LAST_IN_STORE_CITY`, `LAST_IN_STORE_NAME`
- Check for NULL or empty values in fact table

### Still showing 0 after population
**Solution**:
- Clear backend cache (restart server)
- Hard refresh browser (Ctrl+Shift+R)
- Check backend logs for errors

## Next Steps

After successful population:

1. **Restart Backend Server** (to clear cache)
2. **Hard Refresh Frontend** (`Ctrl+Shift+R`)
3. **Check Console Logs** - You should see:
   ```
   ✅ [Filter Master] Loaded in <100ms
   ✅ [Filter Master] States: <number>, Cities: <number>, Stores: <number>
   ```

## Maintenance

### Update Dimension Table (When New Locations Added)

Re-run the populate script:
```bash
mysql -u <username> -p <database_name> < backend/scripts/populate_dim_store_location.sql
```

The script uses `ON DUPLICATE KEY UPDATE`, so it's safe to run multiple times.

### Schedule Automatic Updates

See `DEPLOYMENT_STRATEGY.md` for scheduling options (cron, MySQL events, etc.)

