# Campaign Dashboard Backend Implementation Guide

This document outlines what needs to be implemented to populate the Campaign Dashboard with real database data.

## Files Created

1. **`app/schemas/campaign_dashboard.py`** - Pydantic models for request/response validation
2. **`app/api/routes/campaign_dashboard.py`** - API endpoint with placeholder queries
3. **`app/main.py`** - Updated to include campaign dashboard router

## API Endpoint

**GET** `/api/campaign/dashboard`

### Query Parameters

- `start_date` (optional): Start date filter (YYYY-MM-DD)
- `end_date` (optional): End date filter (YYYY-MM-DD)
- `customer_mobile` (optional): Filter by customer mobile number
- `customer_name` (optional): Filter by customer name
- `r_value_bucket` (optional): Filter by R value bucket
- `f_value_bucket` (optional): Filter by F value bucket
- `m_value_bucket` (optional): Filter by M value bucket

### Response Structure

```json
{
  "kpi": {
    "total_customer": 10000.0,
    "unit_per_transaction": 10.81,
    "profit_per_customer": 0.0,
    "customer_spending": 76892.34,
    "days_to_return": 142.93,
    "retention_rate": 39.81
  },
  "r_score_data": [...],
  "f_score_data": [...],
  "m_score_data": [...],
  "r_value_bucket_data": [...],
  "visits_data": [...],
  "value_data": [...],
  "segment_data": [...],
  "days_to_return_bucket_data": [...],
  "fiscal_year_data": [...]
}
```

## Implementation Steps

### 1. Database Schema Requirements

You'll need to identify or create tables for:

#### Customer Transaction/Visit Table
- Customer ID
- Transaction/Visit date
- Transaction amount
- Quantity/Units
- Profit
- Next visit date (for calculating days to return)

#### RFM Analysis Table (or calculate on-the-fly)
- Customer ID
- R Score (Recency - days since last purchase)
- F Score (Frequency - number of visits)
- M Score (Monetary - total value)
- Last purchase date
- Days since last purchase

#### Customer Master Table
- Customer ID
- Customer name
- Mobile number
- Registration date (to determine new vs old customers)
- Is new customer flag

### 2. Implement Query Functions

Replace the placeholder functions in `app/api/routes/campaign_dashboard.py`:

#### `_get_kpi_data()`
Calculate:
- **Total Customer**: Count distinct customers
- **Unit Per Transaction**: Average quantity per transaction
- **Profit Per Customer**: Average profit per customer
- **Customer Spending**: Sum of all transaction amounts
- **Days to Return**: Average days between visits
- **Retention Rate**: Percentage of returning customers

#### `_get_r_score_data()`
Group customers by R score categories:
- "Bought Most Recently" (high R score)
- "Other" (lower R scores)

#### `_get_f_score_data()`
Group customers by F score (frequency):
- Count customers in each F score bucket (2, 3, 4, etc.)
- Or use descriptive labels like "More Frequent Visit", "Most Rarest Visit"

#### `_get_m_score_data()`
Group customers by M score (monetary value):
- Count customers in each M score category

#### `_get_r_value_bucket_data()`
Group by days since last purchase:
- 1-200 days
- 200-400 days
- 400-600 days
- 600-800 days
- 800-1000 days
- >1000 days

#### `_get_visits_data()`
Count customers by number of visits:
- 1 visit
- 2 visits
- 3 visits
- etc.

#### `_get_value_data()`
Group customers by total spending value:
- 1-1000
- 1000-2000
- 2000-3000
- 3000-4000
- 4000-5000
- >5000

#### `_get_segment_data()`
RFM Segmentation:
- **CHAMPIONS**: High R, F, M scores (R≥3, F≥3, M≥3)
- **POTENTIAL LOYALISTS**: Medium R, F scores (R≥2, F≥2)
- **NEW CUSTOMERS**: High R score (R≥4)
- **NEED ATTENTION**: Low scores

#### `_get_days_to_return_bucket_data()`
Group by return period:
- 1-2 Month (30-60 days)
- 3-6 Month (90-180 days)
- 1-2 Yr (365-730 days)
- >2 Yr (>730 days)

#### `_get_fiscal_year_data()`
Calculate new vs old customer percentage by fiscal year:
- For each year, calculate:
  - New customer % = (new customers / total customers) * 100
  - Old customer % = (old customers / total customers) * 100

### 3. Apply Filters

Each query function receives a `filters` dict. Apply these filters in your queries:

```python
# Example filter application
if filters.get("start_date"):
    query = query.where(TransactionTable.transaction_date >= filters["start_date"])
if filters.get("customer_mobile"):
    query = query.where(CustomerTable.mobile == filters["customer_mobile"])
# etc.
```

### 4. Example Query Pattern

Here's an example of how to structure a query:

```python
async def _get_kpi_data(session: AsyncSession, filters: dict) -> CampaignKPIData:
    # Build base query
    base_query = select(
        func.count(func.distinct(TransactionTable.customer_id)).label("total_customer"),
        func.avg(TransactionTable.quantity).label("unit_per_transaction"),
        func.avg(TransactionTable.profit).label("profit_per_customer"),
        func.sum(TransactionTable.amount).label("customer_spending"),
    )
    
    # Apply date filters
    if filters.get("start_date"):
        base_query = base_query.where(
            TransactionTable.transaction_date >= filters["start_date"]
        )
    if filters.get("end_date"):
        base_query = base_query.where(
            TransactionTable.transaction_date <= filters["end_date"]
        )
    
    # Apply customer filters
    if filters.get("customer_mobile"):
        base_query = base_query.join(CustomerTable).where(
            CustomerTable.mobile == filters["customer_mobile"]
        )
    
    result = (await session.execute(base_query)).first()
    
    # Calculate days to return (separate query)
    days_query = select(
        func.avg(
            func.datediff(
                TransactionTable.next_visit_date,
                TransactionTable.visit_date
            )
        )
    )
    days_to_return = (await session.execute(days_query)).scalar() or 0.0
    
    # Calculate retention rate
    retention_query = select(
        func.count(func.distinct(
            case((CustomerTable.returning_customer == True, CustomerTable.customer_id))
        )) / func.count(func.distinct(CustomerTable.customer_id)) * 100
    )
    retention_rate = (await session.execute(retention_query)).scalar() or 0.0
    
    return CampaignKPIData(
        total_customer=result.total_customer or 0.0,
        unit_per_transaction=result.unit_per_transaction or 0.0,
        profit_per_customer=result.profit_per_customer or 0.0,
        customer_spending=result.customer_spending or 0.0,
        days_to_return=days_to_return,
        retention_rate=retention_rate,
    )
```

### 5. Testing

1. Start the backend server
2. Test the endpoint: `GET /api/campaign/dashboard`
3. Verify all data is returned correctly
4. Test with filters: `GET /api/campaign/dashboard?start_date=2024-01-01&end_date=2024-12-31`

### 6. Performance Considerations

- Consider adding database indexes on:
  - Customer ID
  - Transaction dates
  - RFM scores
- For large datasets, consider:
  - Caching dashboard data
  - Materialized views for RFM analysis
  - Background jobs to pre-calculate metrics

### 7. Next Steps

1. Identify your actual database tables
2. Map the placeholder queries to your schema
3. Implement each query function
4. Test with real data
5. Optimize queries for performance
6. Add error handling for edge cases

## Notes

- All queries use SQLAlchemy async syntax
- Filters are optional and should be applied conditionally
- All numeric values should be converted to float for JSON serialization
- Date comparisons should handle timezone considerations
- Consider using database views or stored procedures for complex calculations

