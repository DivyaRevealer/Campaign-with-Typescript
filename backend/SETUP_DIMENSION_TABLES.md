# Setup Dimension Tables for Campaign Dashboard Filters

## Problem
The filter dropdowns are showing 0 states, 0 cities, 0 stores because the dimension tables are empty.

## Solution
Populate the dimension tables from the fact table (`crm_analysis_tcm`).

## Step-by-Step Instructions

### Option 1: Using Python Script (Recommended)

1. **Ensure dimension tables are created:**
   ```bash
   mysql -u <username> -p <database_name> < backend/database_dimension_tables.sql
   ```

2. **Run the Python population script:**
   ```bash
   cd backend
   python -m scripts.populate_dimension_tables
   ```

   Or from the project root:
   ```bash
   python -m backend.scripts.populate_dimension_tables
   ```

### Option 2: Using SQL Script Directly

1. **Create tables (if not already created):**
   ```bash
   mysql -u <username> -p <database_name> < backend/database_dimension_tables.sql
   ```

2. **Populate tables:**
   ```bash
   mysql -u <username> -p <database_name> < backend/scripts/populate_dimension_tables.sql
   ```

### Option 3: Manual MySQL Commands

1. **Connect to MySQL:**
   ```bash
   mysql -u <username> -p <database_name>
   ```

2. **Run the SQL commands from `backend/scripts/populate_dimension_tables.sql`**

## Verification

After populating, verify the data:

```sql
SELECT COUNT(*) as state_count FROM dim_state;
SELECT COUNT(*) as city_count FROM dim_city;
SELECT COUNT(*) as store_count FROM dim_store;

-- Check sample data
SELECT * FROM dim_state LIMIT 5;
SELECT * FROM dim_city LIMIT 5;
SELECT * FROM dim_store LIMIT 5;
```

## After Population

1. **Restart the backend server** (to clear cache)
2. **Hard refresh the frontend** (Ctrl+Shift+R)
3. **Check the browser console** - you should see:
   ```
   ✅ [Filter Master] States: <number>, Cities: <number>, Stores: <number>
   ```

## Troubleshooting

### Error: "Table doesn't exist"
- Run `backend/database_dimension_tables.sql` first to create the tables

### Error: "No data populated"
- Check that `crm_analysis_tcm` table has data
- Verify column names match: `LAST_IN_STORE_STATE`, `LAST_IN_STORE_CITY`, `LAST_IN_STORE_NAME`

### Still showing 0 after population
- Clear backend cache (restart server)
- Hard refresh browser (Ctrl+Shift+R)
- Check backend logs for errors

