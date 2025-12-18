-- ============================================================================
-- POPULATE dim_store_location FROM FACT TABLE
-- ============================================================================
-- Purpose: Extract unique store/city/state combinations from crm_analysis_tcm
-- Run this script once to populate, then schedule periodic updates
-- ============================================================================

INSERT INTO dim_store_location (store_name, city, state, is_active)
SELECT DISTINCT
    TRIM(LAST_IN_STORE_NAME) as store_name,
    TRIM(LAST_IN_STORE_CITY) as city,
    TRIM(LAST_IN_STORE_STATE) as state,
    TRUE as is_active
FROM crm_analysis_tcm
WHERE LAST_IN_STORE_NAME IS NOT NULL
  AND TRIM(LAST_IN_STORE_NAME) != ''
  AND TRIM(LAST_IN_STORE_NAME) != 'NULL'
  AND LAST_IN_STORE_CITY IS NOT NULL
  AND TRIM(LAST_IN_STORE_CITY) != ''
  AND TRIM(LAST_IN_STORE_CITY) != 'NULL'
  AND LAST_IN_STORE_STATE IS NOT NULL
  AND TRIM(LAST_IN_STORE_STATE) != ''
  AND TRIM(LAST_IN_STORE_STATE) != 'NULL'
ON DUPLICATE KEY UPDATE
    store_name = VALUES(store_name),
    city = VALUES(city),
    state = VALUES(state),
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- SELECT COUNT(*) as total_locations FROM dim_store_location;
-- SELECT COUNT(DISTINCT state) as state_count FROM dim_store_location;
-- SELECT COUNT(DISTINCT city) as city_count FROM dim_store_location;
-- SELECT COUNT(DISTINCT store_name) as store_count FROM dim_store_location;
-- ============================================================================

