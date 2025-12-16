# Campaign Dashboard - Actual Data Quality Issues

## Verified Issues (Based on Code Review)

### 1. **Visits Chart - Data Type Mismatch**
**Location:** `_get_visits_data_optimized()`
**Issue:** 
- Chart shows `F_VALUE` (which is a frequency score, not actual visit count)
- Label says "No. of Visits" which implies actual visit numbers
- `F_VALUE` might be 1, 2, 3, 4, 5 (scores) not actual visit counts

**Question:** Is `F_VALUE` the actual number of visits, or is it a scored value (1-5)?
- If it's a score: Chart label is misleading
- If it's actual visits: Chart is correct

**Action Needed:** Verify what `F_VALUE` represents in your database

---

### 2. **Profit Per Customer - Always Zero**
**Location:** `_get_kpi_data_optimized()` line 129
**Current:** `profit_per_customer=0.0  # Placeholder`
**Issue:** No profit calculation, always shows ₹0.00
**Impact:** KPI card shows meaningless data

**Action Needed:** Either:
- Remove this KPI if profit data unavailable
- Calculate from other tables if profit can be derived
- Replace with "Avg Transaction Value" (total_sales / transaction_count)

---

### 3. **Customer Spending - Label vs Calculation Mismatch**
**Location:** 
- Backend: `func.avg(InvCrmAnalysis.total_sales)` - calculates **average**
- Frontend: Label says "Customer Spending" - implies **total**

**Issue:** Label doesn't match calculation
**Impact:** Users might think it's total spending when it's average

**Action Needed:** Change frontend label to "Avg Customer Spending"

---

## Data Validation Questions

1. **F_VALUE vs Actual Visits:** What does `F_VALUE` represent?
   - If it's a score (1-5), the "No. of Visits" chart is misleading
   - If it's actual visit count, it's correct

2. **Fiscal Year Calculation:** The cumulative logic looks correct, but verify:
   - Are `first_yr_count` through `fifth_yr_count` correctly populated?
   - Does the cumulative calculation match your business logic?

3. **R Score Chart:** Currently only shows 2 categories (score 5 vs others)
   - Is this intentional for your use case?
   - Or should it show all 5 R scores?

---

## Recommendations (Only Real Issues)

1. **Fix Profit Per Customer** - Either remove or replace with meaningful metric
2. **Fix Customer Spending Label** - Add "Avg" prefix
3. **Verify F_VALUE meaning** - Confirm if visits chart is showing correct data

---

## What's Working Correctly

✅ Total Customer calculation
✅ Unit Per Transaction (avg of no_of_items)
✅ Days to Return (avg of days)
✅ Retention Rate (F_SCORE > 1)
✅ R/F/M Value buckets
✅ Segment distribution
✅ Days to Return bucket
✅ Fiscal year calculation logic

