# Automatic Index Creation for crm_analysis_tcm Table

## ✅ No Manual Steps Required!

The deployment scripts **automatically create indexes** for the `crm_analysis_tcm` table when you deploy to a server.

## 🚀 How It Works

### Option 1: Automated Deployment Script (Recommended)

When you run the deployment script, it automatically:

1. ✅ Checks if indexes already exist
2. ✅ Creates all 16 indexes on `crm_analysis_tcm` table
3. ✅ Verifies index creation
4. ✅ Reports success/failure

**Linux/Mac:**
```bash
cd backend
chmod +x deploy_dashboard.sh
./deploy_dashboard.sh
```

**Windows:**
```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\deploy_dashboard.ps1
```

### Option 2: Python Script (Alternative)

If you prefer to run just the index creation:

```bash
cd backend
python scripts/create_tcm_indexes.py
```

### Option 3: SQL Script (Manual)

If you need manual control:

```bash
mysql -u username -p database_name < database_indexes_campaign_dashboard_tcm.sql
```

## 📋 What Gets Created

The deployment script creates **16 indexes** on `crm_analysis_tcm`:

1. `idx_crm_tcm_first_in_date` - Date filtering
2. `idx_crm_tcm_date_range` - Date range queries
3. `idx_crm_tcm_cust_mobile` - Customer mobile filtering
4. `idx_crm_tcm_customer_name` - Customer name filtering
5. `idx_crm_tcm_r_score` - R score grouping
6. `idx_crm_tcm_f_score` - F score grouping
7. `idx_crm_tcm_m_score` - M score grouping
8. `idx_crm_tcm_days` - Days calculations
9. `idx_crm_tcm_f_value` - Frequency value
10. `idx_crm_tcm_total_sales` - Sales calculations
11. `idx_crm_tcm_segment_map` - Segment distribution
12. `idx_crm_tcm_date_customer` - Composite (date + customer)
13. `idx_crm_tcm_rfm_scores` - Composite (R/F/M scores)
14. `idx_crm_tcm_buckets` - Composite (buckets)
15. `idx_crm_tcm_kpi_metrics` - Composite (KPI metrics)
16. `idx_crm_tcm_year_counts` - Composite (year counts)

## 🔍 Verification

After deployment, verify indexes were created:

```sql
SHOW INDEX FROM crm_analysis_tcm;
```

You should see 16 indexes listed.

## ⚠️ Important Notes

1. **Indexes are created automatically** - No manual SQL needed
2. **Safe to run multiple times** - Script checks for existing indexes
3. **Takes 2-5 minutes** - Depending on table size
4. **No downtime required** - Indexes created in background

## 🎯 Expected Performance

- **Before indexes**: 30+ seconds (timeout errors)
- **After indexes**: 1-3 seconds
- **With caching**: <100ms

## 🔄 Re-running Deployment

If you need to recreate indexes:

1. The script will ask: "Do you want to recreate them? (y/N)"
2. Answer 'y' to recreate, 'N' to skip
3. Existing indexes won't cause errors (they'll be skipped)

## 📞 Troubleshooting

### Indexes not created?

1. Check database connection in `.env`
2. Ensure `crm_analysis_tcm` table exists
3. Verify database user has `CREATE INDEX` permission
4. Check deployment logs: `deployment.log`

### Still getting timeouts?

1. Verify indexes exist: `SHOW INDEX FROM crm_analysis_tcm;`
2. Check table has data: `SELECT COUNT(*) FROM crm_analysis_tcm;`
3. Review server logs for query errors
4. Ensure Redis is running (optional, for caching)

## ✅ Summary

**You do NOT need to manually create indexes!**

The deployment scripts handle everything automatically. Just run the deployment script and indexes will be created for you.

