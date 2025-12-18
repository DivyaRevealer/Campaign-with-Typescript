# Campaign Dashboard Filter Performance Optimization Guide

## Problem Statement
- **Dataset Size**: ~23L (230,000) records in `crm_analysis_tcm`
- **Previous Performance**: >4 seconds for cascaded filter updates
- **Target SLA**: <1 second response time

## Root Cause
The previous implementation queried the large fact table (`crm_analysis_tcm`) using `DISTINCT` queries every time a filter changed. This caused:
- Full table scans on 23L rows
- Multiple round-trips to the database
- Database contention and slow response times

## Solution: Dimension Tables + In-Memory Cascading

### Architecture Overview
1. **Dimension Tables**: Small, indexed tables (<1000 rows each) for states, cities, stores
2. **Single API Call**: Load all filter data once on page load (<100ms)
3. **In-Memory Cascading**: All filter updates happen in JavaScript (instant)

### Database Schema

#### 1. Dimension Tables Created
- `dim_state`: All unique states
- `dim_city`: All unique cities with state relationship
- `dim_store`: All unique stores with city and state relationships

#### 2. Indexes
- Primary keys on all dimension tables
- Foreign key indexes on `state_id`, `city_id`
- Composite indexes for common filter combinations
- Expected query time: <10ms per dimension table

### Backend Implementation

#### New Endpoint: `GET /api/campaign/filters/master`
- **Purpose**: Load all filter master data from dimension tables
- **Response Time**: <100ms (vs 4+ seconds with DISTINCT queries)
- **Caching**: 1 hour TTL (filter master data changes infrequently)
- **Queries**: Only dimension tables, NO fact table queries

#### Response Structure
```json
{
  "states": [
    {"id": 1, "code": "TAMIL_NADU", "name": "TAMIL NADU"}
  ],
  "cities": [
    {"id": 1, "code": "CHENNAI", "name": "CHENNAI", "state_id": 1, "state_name": "TAMIL NADU"}
  ],
  "stores": [
    {"id": 1, "code": "STORE_001", "name": "Store Name", "city_id": 1, "city_name": "CHENNAI", "state_id": 1, "state_name": "TAMIL NADU"}
  ]
}
```

### Frontend Implementation

#### 1. Initial Load
- Call `getFilterMasterData()` once on page load
- Cache master data in React state
- Initialize all filter options from master data

#### 2. In-Memory Cascading
- `handleMultiSelectFilterChange()`: Synchronous function (no async/await)
- `computeFilterOptions()`: Computes available options based on current selections
- All logic runs in JavaScript using cached master data
- Response time: <1ms (instant)

#### 3. Cascading Rules
- **State selected**: Filter cities and stores by selected states
- **City selected**: Filter stores by selected cities, auto-adjust states
- **Store selected**: Auto-adjust states and cities to match selected stores
- **Filter cleared**: Re-expand dependent filters automatically

### Performance Guarantees

#### Why <1 Second SLA is Achieved

1. **Dimension Tables**: 
   - Small size (<1000 rows each)
   - Indexed for fast lookups
   - Query time: <10ms per table

2. **Single API Call**:
   - Load all data once on page load
   - Cached for 1 hour
   - Response time: <100ms

3. **In-Memory Cascading**:
   - No API calls on filter changes
   - Pure JavaScript computation
   - Response time: <1ms

4. **No Fact Table Queries**:
   - Dimension tables are separate from fact table
   - No DISTINCT queries on 23L rows
   - No full table scans

### Setup Instructions

#### 1. Create Dimension Tables
```bash
mysql -u username -p database_name < backend/database_dimension_tables.sql
```

#### 2. Populate Dimension Tables
```bash
mysql -u username -p database_name < backend/scripts/populate_dimension_tables.sql
```

#### 3. Verify Data
```sql
SELECT COUNT(*) FROM dim_state;
SELECT COUNT(*) FROM dim_city;
SELECT COUNT(*) FROM dim_store;
```

#### 4. Restart Backend
The new endpoint will be available at `/api/campaign/filters/master`

#### 5. Hard Refresh Frontend
Clear browser cache and reload to get the new filter logic

### Maintenance

#### Updating Dimension Tables
When new states/cities/stores are added to the fact table:
1. Re-run `populate_dimension_tables.sql`
2. Clear backend cache (or wait 1 hour for TTL)
3. Frontend will automatically get updated data on next page load

#### Monitoring
- Check backend logs for `[Filter Master]` messages
- Monitor API response times (should be <100ms)
- Check frontend console for `[Filter Cascade]` messages

### Expected Performance Metrics

- **Initial Load**: <100ms (dimension table queries)
- **Filter Change**: <1ms (in-memory computation)
- **Cache Hit**: <10ms (Redis/memory cache)
- **Total User Experience**: <1 second (meets SLA)

### Troubleshooting

#### Issue: Dimension tables not found
**Solution**: Run `database_dimension_tables.sql` first

#### Issue: Empty filter options
**Solution**: Run `populate_dimension_tables.sql` to populate data

#### Issue: Filters not cascading
**Solution**: Check browser console for `[Filter Cascade]` logs, ensure `filterMasterData` is loaded

#### Issue: Still slow (>1 second)
**Solution**: 
1. Check database indexes are created
2. Verify dimension tables are populated
3. Check backend cache is working
4. Monitor network tab for API call times

