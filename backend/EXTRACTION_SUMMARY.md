# Extraction and Adaptation Summary

This document summarizes what was extracted from the old RFM backend files and adapted to the current IMS project structure.

## Files Extracted From

1. `controllers/dashboard.py` - Main dashboard logic
2. `models/crm_analysis.py` - CRM Analysis model
3. Other campaign models (for reference, not directly used)

## What Was Created/Updated

### 1. **New Model: `app/models/inv_crm_analysis.py`**
   - Extracted from `models/crm_analysis.py`
   - Adapted to current project structure:
     - Uses `Base` from `app.models.base`
     - Uses `Mapped` and `mapped_column` (SQLAlchemy 2.0 style)
     - Field names converted to snake_case (Python convention)
     - Database column names preserved (uppercase) via `mapped_column` first argument
   - Contains all RFM analysis fields:
     - Customer info (mobile, name, dates)
     - RFM values and scores (R_VALUE, F_VALUE, M_VALUE, R_SCORE, F_SCORE, M_SCORE)
     - Segmentation (SEGMENT_MAP, RFM_SCORE)
     - Transaction data (NO_OF_ITEMS, TOTAL_SALES, DAYS)
     - Year counts (FIRST_YR_COUNT through FIFTH_YR_COUNT)

### 2. **Updated Route: `app/api/routes/campaign_dashboard.py`**
   - Extracted query logic from `controllers/dashboard.py`
   - Converted from sync SQLAlchemy to async
   - Adapted filtering logic from old `get_dashboard_data()` function
   - Implemented aggregation logic from old `get_last_three_charts()` function

#### Key Adaptations:

**KPI Data (`_get_kpi_data`)**:
- Total Customer: Count from `crm_analysis` table
- Unit Per Transaction: Average of `NO_OF_ITEMS`
- Customer Spending: Sum of `TOTAL_SALES`
- Days to Return: Average of `DAYS`
- Retention Rate: Percentage of customers with `F_SCORE > 1`
- Profit Per Customer: Placeholder (needs profit calculation if available)

**R/F/M Score Data**:
- R Score: Groups by R_SCORE >= 4 ("Bought Most Recently") vs others
- F Score: Groups by F_SCORE with labels (1="Most Rarest Visit", 5="More Frequent Visit")
- M Score: Groups by M_SCORE as "Category 1", "Category 2", etc.

**R Value Bucket**:
- Uses `DAYS` field to bucket into ranges (1-200, 200-400, etc.)

**Visits Data**:
- Uses `F_VALUE` (frequency value) to count customers by visit frequency

**Value Data**:
- Uses `TOTAL_SALES` to bucket customers by spending ranges

**Segment Data**:
- Uses `SEGMENT_MAP` field directly
- Includes color mapping for visualization

**Days to Return Bucket**:
- Uses `DAYS` field
- Buckets: "1-2 Month" (≤60), "3-6 Month" (≤180), "1-2 Yr" (≤730), ">2 Yr" (>730)
- Matches frontend chart expectations

**Fiscal Year Data**:
- Uses year count fields (FIRST_YR_COUNT = 2024, FIFTH_YR_COUNT = 2020)
- Calculates new vs old customer percentages cumulatively
- Matches old logic exactly

### 3. **Updated Models Export: `app/models/__init__.py`**
   - Added `InvCrmAnalysis` to exports

## Key Differences from Old Code

1. **Async/Await**: All queries converted to async SQLAlchemy
2. **Query Building**: Uses `select()` instead of `db.query()`
3. **Filter Application**: Filters applied conditionally in query building
4. **Type Safety**: Uses Pydantic models for response validation
5. **Naming**: Follows current project conventions (snake_case for Python, uppercase for DB columns)

## Database Table Required

The code expects a table named `crm_analysis` with the following key columns:
- `CUST_MOBILENO` (primary key)
- `CUSTOMER_NAME`
- `FIRST_IN_DATE` (for date filtering)
- `R_VALUE`, `F_VALUE`, `M_VALUE`
- `R_SCORE`, `F_SCORE`, `M_SCORE`
- `SEGMENT_MAP`
- `NO_OF_ITEMS`, `TOTAL_SALES`
- `DAYS`
- `FIRST_YR_COUNT` through `FIFTH_YR_COUNT`

## Testing

1. Ensure the `crm_analysis` table exists in your database
2. Test the endpoint: `GET /api/campaign/dashboard`
3. Test with filters: `GET /api/campaign/dashboard?start_date=2024-01-01&end_date=2024-12-31`
4. Verify all charts populate correctly

## Notes

- The old code used sync SQLAlchemy (`db.query()`), new code uses async (`select()`)
- Filter logic matches the old implementation
- Aggregation logic for segments, days buckets, and fiscal year matches old code
- All numeric values are converted to float for JSON serialization
- The model preserves original database column names while using Python naming conventions

