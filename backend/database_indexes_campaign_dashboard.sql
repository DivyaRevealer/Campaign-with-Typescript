-- ============================================================================
-- CAMPAIGN DASHBOARD PERFORMANCE OPTIMIZATION - DATABASE INDEXES
-- ============================================================================
-- This script creates indexes to optimize Campaign Dashboard queries
-- Run this script on your MySQL database to improve query performance
-- Expected improvement: 10-50x faster queries on 100K+ records
-- ============================================================================

-- 1. Indexes for Filter Columns (Most Common Filters)
-- ============================================================================

-- Date range filtering (FIRST_IN_DATE is used in all queries)
CREATE INDEX IF NOT EXISTS idx_crm_first_in_date 
ON crm_analysis(FIRST_IN_DATE);

-- Composite index for date range queries (optimizes WHERE clauses)
CREATE INDEX IF NOT EXISTS idx_crm_date_range 
ON crm_analysis(FIRST_IN_DATE, LAST_IN_DATE);

-- Customer mobile number filtering
CREATE INDEX IF NOT EXISTS idx_crm_cust_mobile 
ON crm_analysis(CUST_MOBILENO);

-- Customer name filtering
CREATE INDEX IF NOT EXISTS idx_crm_customer_name 
ON crm_analysis(CUSTOMER_NAME);

-- 2. Indexes for RFM Analysis Columns (Heavy Aggregation)
-- ============================================================================

-- R Score (Recency) - used in grouping and filtering
CREATE INDEX IF NOT EXISTS idx_crm_r_score 
ON crm_analysis(R_SCORE);

-- F Score (Frequency) - used in grouping and filtering
CREATE INDEX IF NOT EXISTS idx_crm_f_score 
ON crm_analysis(F_SCORE);

-- M Score (Monetary) - used in grouping and filtering
CREATE INDEX IF NOT EXISTS idx_crm_m_score 
ON crm_analysis(M_SCORE);

-- Days field (used for R value bucket calculations)
CREATE INDEX IF NOT EXISTS idx_crm_days 
ON crm_analysis(DAYS);

-- F Value (Frequency value) - used in visits data
CREATE INDEX IF NOT EXISTS idx_crm_f_value 
ON crm_analysis(F_VALUE);

-- Total Sales (used for M value bucket calculations)
CREATE INDEX IF NOT EXISTS idx_crm_total_sales 
ON crm_analysis(TOTAL_SALES);

-- Segment Map (used in segment distribution)
CREATE INDEX IF NOT EXISTS idx_crm_segment_map 
ON crm_analysis(SEGMENT_MAP);

-- 3. Composite Indexes for Common Filter Combinations
-- ============================================================================

-- Composite index for date + customer filters (most common combination)
CREATE INDEX IF NOT EXISTS idx_crm_date_customer 
ON crm_analysis(FIRST_IN_DATE, CUST_MOBILENO, CUSTOMER_NAME);

-- Composite index for RFM filtering (R, F, M scores together)
CREATE INDEX IF NOT EXISTS idx_crm_rfm_scores 
ON crm_analysis(R_SCORE, F_SCORE, M_SCORE);

-- Composite index for bucket calculations (Days + Total Sales)
CREATE INDEX IF NOT EXISTS idx_crm_buckets 
ON crm_analysis(DAYS, TOTAL_SALES, F_VALUE);

-- 4. Indexes for Aggregation Columns (KPI Calculations)
-- ============================================================================

-- Composite index for KPI calculations (most frequently aggregated columns)
CREATE INDEX IF NOT EXISTS idx_crm_kpi_metrics 
ON crm_analysis(NO_OF_ITEMS, TOTAL_SALES, DAYS, F_SCORE);

-- 5. Indexes for Year Count Fields (Fiscal Year Data)
-- ============================================================================

-- Composite index for fiscal year calculations
CREATE INDEX IF NOT EXISTS idx_crm_year_counts 
ON crm_analysis(FIRST_YR_COUNT, SECOND_YR_COUNT, THIRD_YR_COUNT, FOURTH_YR_COUNT, FIFTH_YR_COUNT);

-- 6. Verify Indexes (Optional - Run to check if indexes were created)
-- ============================================================================
-- SELECT 
--     TABLE_NAME,
--     INDEX_NAME,
--     COLUMN_NAME,
--     SEQ_IN_INDEX
-- FROM 
--     INFORMATION_SCHEMA.STATISTICS
-- WHERE 
--     TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME = 'crm_analysis'
-- ORDER BY 
--     INDEX_NAME, SEQ_IN_INDEX;

-- ============================================================================
-- PERFORMANCE NOTES:
-- ============================================================================
-- 1. These indexes will speed up:
--    - WHERE clause filtering (date ranges, customer filters)
--    - GROUP BY operations (R/F/M scores, buckets)
--    - Aggregate functions (COUNT, AVG, SUM)
--
-- 2. Index maintenance:
--    - Indexes are automatically maintained by MySQL
--    - Slight overhead on INSERT/UPDATE operations (acceptable trade-off)
--    - Monitor index usage with: SHOW INDEX FROM crm_analysis;
--
-- 3. Expected query time improvements:
--    - Without indexes: 30+ seconds on 100K records
--    - With indexes: 1-3 seconds on 100K records
--    - With caching: <100ms for cached results
-- ============================================================================

