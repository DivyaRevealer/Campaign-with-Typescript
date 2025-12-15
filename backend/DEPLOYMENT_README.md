# Campaign Dashboard - Automated Deployment Guide

## 🚀 Quick Start

### Linux/Mac

```bash
cd backend
chmod +x deploy_dashboard.sh
./deploy_dashboard.sh
```

### Windows

```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\deploy_dashboard.ps1
```

## 📋 What the Script Does

The automated deployment script handles:

1. ✅ **Checks Prerequisites**
   - Python 3.8+ installed
   - pip package manager
   - MySQL client
   - Required files present

2. ✅ **Installs Dependencies**
   - Installs all Python packages from `requirements.txt`
   - Including `redis>=5.0.0` for caching

3. ✅ **Creates Database Indexes**
   - Creates 16 performance indexes on `crm_analysis` table
   - Speeds up queries by 10-50x
   - Verifies index creation

4. ✅ **Sets Up Redis (Optional)**
   - Installs Redis server (if not present)
   - Starts Redis service
   - Configures `.env` with Redis settings
   - Works without Redis (just slower)

5. ✅ **Verifies Configuration**
   - Checks that optimized router is being used
   - Updates `app/main.py` if needed
   - Creates backup before changes

6. ✅ **Generates Report**
   - Creates detailed deployment report
   - Lists all configured components
   - Provides next steps and troubleshooting tips

7. ✅ **Tests Dashboard (Optional)**
   - Starts development server
   - Allows you to test the deployment

## 📝 Prerequisites

Before running the script, ensure you have:

- **Database Access**: MySQL credentials (host, user, password, database name)
- **Python 3.8+**: Installed and in PATH
- **MySQL Client**: Installed (for running SQL scripts)
- **Admin Rights**: For installing Redis (optional)

## 🔧 Configuration

### Option 1: Create `.env` File (Recommended)

Create `backend/.env` with your settings:

```env
# Database Configuration
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database

# Redis Configuration (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_ENABLED=true

# Application Settings
DATABASE_URL=mysql+aiomysql://user:password@localhost/database
SECRET_KEY=your_secret_key
```

### Option 2: Interactive Prompts

If no `.env` file exists, the script will prompt you for:
- MySQL host
- MySQL username
- MySQL password
- Database name

## 📊 What Gets Installed

### Database Indexes (16 total)

```sql
idx_crm_first_in_date      -- Date filtering
idx_crm_date_range          -- Date range queries
idx_crm_cust_mobile         -- Customer mobile filter
idx_crm_customer_name       -- Customer name filter
idx_crm_r_score             -- RFM R score
idx_crm_f_score             -- RFM F score
idx_crm_m_score             -- RFM M score
idx_crm_days                -- Recency days
idx_crm_f_value             -- Frequency value
idx_crm_total_sales         -- Monetary value
idx_crm_segment_map         -- Customer segments
idx_crm_date_customer       -- Composite: date + customer
idx_crm_rfm_scores          -- Composite: R, F, M scores
idx_crm_buckets             -- Composite: days, sales, frequency
idx_crm_kpi_metrics         -- KPI calculations
idx_crm_year_counts         -- Fiscal year data
```

### Python Packages

- `fastapi` - Web framework
- `sqlalchemy` - Database ORM
- `redis>=5.0.0` - Caching (optional)
- `aiomysql` - Async MySQL driver
- `asyncio` - Async execution
- All other packages in `requirements.txt`

### Redis Server (Optional)

- **Linux**: Installed via apt/yum
- **macOS**: Installed via Homebrew
- **Windows**: Via Docker or manual installation

## 🎯 Performance Expectations

| Scenario | Before Optimization | After Optimization |
|----------|---------------------|-------------------|
| 10K records | 3-5 seconds | <2 seconds |
| 100K records | 30+ seconds | 3-5 seconds |
| 1M records | Timeout (>60s) | 10-15 seconds |
| **With Redis Cache** | N/A | **<100ms** |

## ✅ Verification

After deployment, verify:

### 1. Check Indexes

```bash
mysql -u username -p database_name
```

```sql
SHOW INDEX FROM crm_analysis WHERE Key_name LIKE 'idx_crm_%';
```

You should see 16 indexes.

### 2. Check Redis

```bash
redis-cli ping
```

Should return: `PONG`

### 3. Check Python Packages

```bash
pip list | grep redis
```

Should show: `redis 5.x.x`

### 4. Check Backend Configuration

```bash
grep "campaign_dashboard_optimized" app/main.py
```

Should show the optimized import.

### 5. Test API

```bash
# Start server
python -m uvicorn app.main:app --reload

# In another terminal, test
curl http://localhost:8000/api/campaign/dashboard/filters
```

## 📁 Generated Files

After deployment, you'll find:

```
backend/
├── deployment.log              # Full deployment log
├── deployment_report.txt       # Summary report
├── app/main.py.backup          # Backup (if router was updated)
└── .env                        # Updated with Redis config
```

## 🔍 Troubleshooting

### Issue: "MySQL client not found"

**Solution:**
```bash
# Linux
sudo apt-get install mysql-client

# macOS
brew install mysql-client

# Windows
Download from: https://dev.mysql.com/downloads/installer/
```

### Issue: "Cannot connect to database"

**Solution:**
1. Check database is running
2. Verify credentials in `.env`
3. Test connection:
   ```bash
   mysql -h localhost -u username -p
   ```

### Issue: "Redis not available"

**Solution:**
- Dashboard works without Redis (just slower)
- To install Redis:
  ```bash
  # Linux
  sudo apt-get install redis-server
  
  # macOS
  brew install redis
  
  # Windows
  docker run -d -p 6379:6379 redis
  ```

### Issue: "Script permission denied"

**Solution:**
```bash
chmod +x deploy_dashboard.sh
```

### Issue: "Indexes already exist"

**Solution:**
- Script will ask if you want to recreate them
- Choose 'N' to skip, 'Y' to recreate

### Issue: "Still slow after deployment"

**Solution:**
1. Verify indexes:
   ```sql
   SHOW INDEX FROM crm_analysis;
   ```

2. Check query execution plan:
   ```sql
   EXPLAIN SELECT * FROM crm_analysis WHERE FIRST_IN_DATE >= '2024-01-01';
   ```

3. Ensure Redis is running:
   ```bash
   redis-cli ping
   ```

4. Check logs:
   ```bash
   tail -f deployment.log
   ```

## 🔄 Rollback

If something goes wrong:

### 1. Restore Router (if changed)

```bash
cd backend
mv app/main.py.backup app/main.py
```

### 2. Remove Indexes (if needed)

```sql
DROP INDEX idx_crm_first_in_date ON crm_analysis;
DROP INDEX idx_crm_date_range ON crm_analysis;
-- ... (drop all 16 indexes)
```

### 3. Stop Redis

```bash
# Linux
sudo systemctl stop redis

# macOS
brew services stop redis

# Docker
docker stop redis
```

## 🎓 Manual Deployment

If you prefer manual deployment, follow these steps:

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Create Indexes

```bash
mysql -u username -p database_name < database_indexes_campaign_dashboard.sql
```

### 3. Configure Redis (Optional)

```bash
# Install Redis
sudo apt-get install redis-server  # Linux
brew install redis                   # macOS

# Start Redis
sudo systemctl start redis           # Linux
brew services start redis            # macOS
```

### 4. Update Router

Edit `backend/app/main.py`:

```python
# Change this:
from app.api.routes.campaign_dashboard import router

# To this:
from app.api.routes.campaign_dashboard_optimized import router
```

### 5. Configure Environment

Create `backend/.env`:

```env
DATABASE_URL=mysql+aiomysql://user:password@localhost/database
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_ENABLED=true
```

### 6. Test

```bash
python -m uvicorn app.main:app --reload
```

## 📞 Support

If you encounter issues:

1. Check the logs: `deployment.log`
2. Review the report: `deployment_report.txt`
3. Verify each step in the checklist above
4. Check system requirements match your environment

## 🎉 Success Criteria

Deployment is successful when:

- ✅ All 16 indexes are created
- ✅ Redis is installed and running (or disabled)
- ✅ Backend uses optimized router
- ✅ Dashboard loads in <10 seconds
- ✅ Cached responses in <100ms (with Redis)
- ✅ No errors in logs

---

**Ready to deploy!** Run the script and follow the prompts. The whole process takes 5-10 minutes.

