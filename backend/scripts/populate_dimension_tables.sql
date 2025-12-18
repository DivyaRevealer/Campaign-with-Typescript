-- ============================================================================
-- POPULATE DIMENSION TABLES FROM FACT TABLE
-- ============================================================================
-- Purpose: Extract unique state/city/store combinations from crm_analysis_tcm
-- Run this script once to populate dimensions, then schedule periodic updates
-- ============================================================================

-- Step 1: Populate States
-- ============================================================================
INSERT INTO dim_state (code, name, is_active)
SELECT DISTINCT
    UPPER(TRIM(REPLACE(REPLACE(LAST_IN_STORE_STATE, ' ', '_'), '-', '_'))) as code,
    TRIM(LAST_IN_STORE_STATE) as name,
    TRUE as is_active
FROM crm_analysis_tcm
WHERE LAST_IN_STORE_STATE IS NOT NULL
  AND TRIM(LAST_IN_STORE_STATE) != ''
  AND TRIM(LAST_IN_STORE_STATE) != 'NULL'
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = CURRENT_TIMESTAMP;

-- Step 2: Populate Cities (with state mapping)
-- ============================================================================
INSERT INTO dim_city (code, name, state_id, is_active)
SELECT DISTINCT
    UPPER(TRIM(REPLACE(REPLACE(REPLACE(tcm.LAST_IN_STORE_CITY, ' ', '_'), '-', '_'), '/', '_'))) as code,
    TRIM(tcm.LAST_IN_STORE_CITY) as name,
    ds.id as state_id,
    TRUE as is_active
FROM crm_analysis_tcm tcm
INNER JOIN dim_state ds ON TRIM(tcm.LAST_IN_STORE_STATE) = ds.name
WHERE tcm.LAST_IN_STORE_CITY IS NOT NULL
  AND TRIM(tcm.LAST_IN_STORE_CITY) != ''
  AND TRIM(tcm.LAST_IN_STORE_CITY) != 'NULL'
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    state_id = VALUES(state_id),
    updated_at = CURRENT_TIMESTAMP;

-- Step 3: Populate Stores (with city and state mapping)
-- ============================================================================
INSERT INTO dim_store (code, name, city_id, state_id, is_active)
SELECT DISTINCT
    UPPER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(tcm.LAST_IN_STORE_NAME, ' ', '_'), '-', '_'), '/', '_'), '(', '_'))) as code,
    TRIM(tcm.LAST_IN_STORE_NAME) as name,
    dc.id as city_id,
    ds.id as state_id,
    TRUE as is_active
FROM crm_analysis_tcm tcm
INNER JOIN dim_state ds ON TRIM(tcm.LAST_IN_STORE_STATE) = ds.name
INNER JOIN dim_city dc ON TRIM(tcm.LAST_IN_STORE_CITY) = dc.name AND dc.state_id = ds.id
WHERE tcm.LAST_IN_STORE_NAME IS NOT NULL
  AND TRIM(tcm.LAST_IN_STORE_NAME) != ''
  AND TRIM(tcm.LAST_IN_STORE_NAME) != 'NULL'
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    city_id = VALUES(city_id),
    state_id = VALUES(state_id),
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify population:
-- SELECT COUNT(*) as state_count FROM dim_state;
-- SELECT COUNT(*) as city_count FROM dim_city;
-- SELECT COUNT(*) as store_count FROM dim_store;
-- 
-- SELECT ds.name as state, COUNT(dc.id) as city_count
-- FROM dim_state ds
-- LEFT JOIN dim_city dc ON ds.id = dc.state_id
-- GROUP BY ds.id, ds.name
-- ORDER BY ds.name;
-- ============================================================================

