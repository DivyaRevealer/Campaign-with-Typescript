-- ============================================================================
-- CAMPAIGN DASHBOARD DIMENSION TABLES FOR CASCADING FILTERS
-- ============================================================================
-- Purpose: Replace DISTINCT queries on large fact tables with fast dimension lookups
-- Performance: <100ms response time for filter master data
-- ============================================================================

-- 1. DIMENSION: States
-- ============================================================================
CREATE TABLE IF NOT EXISTS dim_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dim_state_code (code),
    INDEX idx_dim_state_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. DIMENSION: Cities
-- ============================================================================
CREATE TABLE IF NOT EXISTS dim_city (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    state_id INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (state_id) REFERENCES dim_state(id) ON DELETE CASCADE,
    INDEX idx_dim_city_code (code),
    INDEX idx_dim_city_state (state_id),
    INDEX idx_dim_city_active (is_active),
    INDEX idx_dim_city_state_active (state_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. DIMENSION: Stores
-- ============================================================================
CREATE TABLE IF NOT EXISTS dim_store (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    city_id INT NOT NULL,
    state_id INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES dim_city(id) ON DELETE CASCADE,
    FOREIGN KEY (state_id) REFERENCES dim_state(id) ON DELETE CASCADE,
    INDEX idx_dim_store_code (code),
    INDEX idx_dim_store_city (city_id),
    INDEX idx_dim_store_state (state_id),
    INDEX idx_dim_store_active (is_active),
    INDEX idx_dim_store_city_state (city_id, state_id),
    INDEX idx_dim_store_city_state_active (city_id, state_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PERFORMANCE NOTES:
-- ============================================================================
-- 1. All tables use InnoDB for foreign key support
-- 2. Indexes on foreign keys (state_id, city_id) for fast joins
-- 3. Composite indexes for common filter combinations
-- 4. Unique constraints prevent duplicates
-- 5. Expected size: <1000 rows total (vs 23L in fact table)
-- 6. Query time: <10ms for full dimension load
-- ============================================================================

