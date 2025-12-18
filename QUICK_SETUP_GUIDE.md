# Quick Setup Guide - Dimension Table

## The Problem
Your filter master data is loading but returning **0 states, 0 cities, 0 stores**. This means the `dim_store_location` table is empty.

## Quick Fix (Choose One Method)

### Method 1: Python Script (Easiest) ✅

From your project root directory, run:

```powershell
python -m backend.scripts.populate_dim_store_location
```

This will:
- Check if the table exists
- Populate it from the fact table
- Show you the counts

### Method 2: MySQL Command Line

```powershell
# Step 1: Create table (if not exists)
mysql -u appadmin -p ims < backend\database_dim_store_location.sql

# Step 2: Populate table
mysql -u appadmin -p ims < backend\scripts\populate_dim_store_location.sql
```

Replace `appadmin` and `ims` with your actual MySQL username and database name.

### Method 3: MySQL Workbench / phpMyAdmin

1. **Create Table**: 
   - Open `backend/database_dim_store_location.sql`
   - Copy all SQL
   - Paste and execute in MySQL Workbench

2. **Populate Table**:
   - Open `backend/scripts/populate_dim_store_location.sql`
   - Copy all SQL
   - Paste and execute in MySQL Workbench

## Verify It Worked

After populating, run this in MySQL:

```sql
SELECT COUNT(*) as total FROM dim_store_location;
SELECT COUNT(DISTINCT state) as states FROM dim_store_location;
SELECT COUNT(DISTINCT city) as cities FROM dim_store_location;
SELECT COUNT(DISTINCT store_name) as stores FROM dim_store_location;
```

You should see numbers > 0.

## After Populating

1. **Restart Backend Server** (clears cache)
2. **Hard Refresh Browser** (`Ctrl+Shift+R`)
3. **Check Console** - You should see:
   ```
   ✅ [Filter Master] States: <number>, Cities: <number>, Stores: <number>
   ```

## Troubleshooting

### "Table doesn't exist"
**Fix**: Run the create script first:
```powershell
mysql -u appadmin -p ims < backend\database_dim_store_location.sql
```

### "Access denied"
**Fix**: Check your MySQL credentials in `.env` file or use correct username/password

### Still showing 0 after population
**Fix**: 
1. Verify data exists: `SELECT COUNT(*) FROM dim_store_location;`
2. Restart backend server
3. Hard refresh browser
4. Check backend logs for errors

