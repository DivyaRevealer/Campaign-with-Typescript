-- ============================================================================
-- DIMENSION TABLE: dim_store_location
-- ============================================================================
-- Purpose: Fast lookup table for store/city/state combinations
-- Replaces DISTINCT queries on large fact table (2.3M rows)
-- Performance: <10ms queries vs 4+ seconds with DISTINCT
-- ============================================================================

CREATE TABLE IF NOT EXISTS dim_store_location (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_name VARCHAR(255) NOT NULL,
    city VARCHAR(255) NOT NULL,
    state VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dim_store_location_store (store_name),
    INDEX idx_dim_store_location_city (city),
    INDEX idx_dim_store_location_state (state),
    INDEX idx_dim_store_location_city_state (city, state),
    INDEX idx_dim_store_location_state_city (state, city),
    INDEX idx_dim_store_location_active (is_active),
    UNIQUE KEY uk_store_location (store_name, city, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PERFORMANCE NOTES:
-- ============================================================================
-- 1. Unique constraint prevents duplicate store/city/state combinations
-- 2. Indexes on store_name, city, state for fast lookups
-- 3. Composite indexes for common filter combinations
-- 4. Expected size: <10,000 rows (vs 2.3M in fact table)
-- 5. Query time: <10ms for full dimension load
-- ============================================================================

