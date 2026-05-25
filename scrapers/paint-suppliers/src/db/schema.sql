-- Paint Supplier Scraper Database Schema
-- Version: 1.0.0
-- Supports: Sherwin-Williams, PPG, Benjamin Moore

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_scraped_at DATETIME,
    last_successful_scrape_at DATETIME,
    scrape_frequency_hours INTEGER DEFAULT 168, -- Weekly
    config_json TEXT, -- Supplier-specific config
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products table (paints, primers, etc.)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, -- supplier_id:sku
    supplier_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    product_line TEXT, -- e.g., "SuperPaint", "Duration", "Regal Select"
    type TEXT NOT NULL, -- interior, exterior, primer, specialty
    category TEXT, -- paint, primer, stain, etc.
    sheens TEXT, -- JSON array: ["flat", "eggshell", "satin", "semi-gloss", "gloss"]
    bases TEXT, -- JSON array: ["extra white", "deep base", "ultra deep"]
    description TEXT,
    features TEXT, -- JSON array of features
    url TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT 1,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_products_type ON products(type);
CREATE INDEX idx_products_active ON products(is_active);

-- Pricing table (supports multiple sizes and tiers)
CREATE TABLE IF NOT EXISTS pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    size TEXT NOT NULL, -- "1 gallon", "5 gallon", "quart"
    price_cents INTEGER NOT NULL, -- Store in cents to avoid float issues
    currency TEXT DEFAULT 'USD',
    tier TEXT DEFAULT 'retail', -- retail, contractor, pro_plus
    effective_date DATE DEFAULT CURRENT_DATE,
    is_current BOOLEAN DEFAULT 1,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_pricing_product ON pricing(product_id);
CREATE INDEX idx_pricing_current ON pricing(is_current);
CREATE INDEX idx_pricing_effective ON pricing(effective_date);

-- Colors table
CREATE TABLE IF NOT EXISTS colors (
    id TEXT PRIMARY KEY, -- supplier_id:color_code
    supplier_id TEXT NOT NULL,
    color_code TEXT NOT NULL,
    name TEXT NOT NULL,
    hex_code TEXT, -- #RRGGBB
    rgb_r INTEGER,
    rgb_g INTEGER,
    rgb_b INTEGER,
    collection TEXT, -- e.g., "Timeless", "Historical"
    family TEXT, -- e.g., "blues", "neutrals", "greens"
    lrv INTEGER, -- Light Reflectance Value 0-100
    is_popular BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX idx_colors_supplier ON colors(supplier_id);
CREATE INDEX idx_colors_family ON colors(family);
CREATE INDEX idx_colors_popular ON colors(is_popular);

-- Product-Color many-to-many relationship
CREATE TABLE IF NOT EXISTS product_colors (
    product_id TEXT NOT NULL,
    color_id TEXT NOT NULL,
    is_available BOOLEAN DEFAULT 1,
    base_required TEXT, -- extra-white, deep-base, ultra-deep, etc.
    recommended_use TEXT, -- JSON array: ["interior", "exterior", "both"]
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, color_id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (color_id) REFERENCES colors(id)
);

CREATE INDEX idx_product_colors_product ON product_colors(product_id);
CREATE INDEX idx_product_colors_color ON product_colors(color_id);
CREATE INDEX idx_product_colors_available ON product_colors(is_available);

-- Specifications table
CREATE TABLE IF NOT EXISTS specifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    coverage_rate_sqft_per_gal_min INTEGER,
    coverage_rate_sqft_per_gal_max INTEGER,
    voc_grams_per_liter INTEGER,
    dry_time_to_touch_minutes INTEGER,
    dry_time_to_recoat_hours INTEGER,
    application_methods TEXT, -- JSON array: ["brush", "roller", "spray"]
    recommended_surfaces TEXT, -- JSON array
    cleanup TEXT,
    warranty_years INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_specs_product ON specifications(product_id);

-- Sundries table (brushes, rollers, tape, etc.)
CREATE TABLE IF NOT EXISTS sundries (
    id TEXT PRIMARY KEY, -- supplier_id:sku
    supplier_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- brushes, rollers, tape, drop_cloths, tools, prep
    subcategory TEXT,
    description TEXT,
    price_cents INTEGER,
    size TEXT,
    material TEXT,
    url TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT 1,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX idx_sundries_supplier ON sundries(supplier_id);
CREATE INDEX idx_sundries_category ON sundries(category);

-- Scrape logs for audit trail
CREATE TABLE IF NOT EXISTS scrape_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL,
    scrape_type TEXT NOT NULL, -- products, pricing, colors, sundries, full
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    status TEXT NOT NULL, -- running, success, failed, partial
    items_scraped INTEGER DEFAULT 0,
    items_created INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    items_deactivated INTEGER DEFAULT 0,
    error_message TEXT,
    error_stack TEXT,
    scrape_duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX idx_logs_supplier ON scrape_logs(supplier_id);
CREATE INDEX idx_logs_status ON scrape_logs(status);
CREATE INDEX idx_logs_started ON scrape_logs(started_at);

-- Data quality issues
CREATE TABLE IF NOT EXISTS data_quality_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL,
    issue_type TEXT NOT NULL, -- missing_price, invalid_color, parse_error, etc.
    severity TEXT NOT NULL, -- low, medium, high, critical
    entity_type TEXT, -- product, color, pricing
    entity_id TEXT,
    description TEXT NOT NULL,
    details_json TEXT,
    is_resolved BOOLEAN DEFAULT 0,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX idx_issues_supplier ON scrape_logs(supplier_id);
CREATE INDEX idx_issues_resolved ON data_quality_issues(is_resolved);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial schema');

-- Views for common queries

-- Current pricing view
CREATE VIEW IF NOT EXISTS current_pricing AS
SELECT 
    p.id as product_id,
    p.name as product_name,
    p.supplier_id,
    s.name as supplier_name,
    pr.size,
    pr.price_cents,
    pr.currency,
    pr.tier,
    pr.effective_date
FROM products p
JOIN pricing pr ON p.id = pr.product_id
JOIN suppliers s ON p.supplier_id = s.id
WHERE pr.is_current = 1 AND p.is_active = 1;

-- Product catalog view
CREATE VIEW IF NOT EXISTS product_catalog AS
SELECT 
    p.id,
    p.name,
    p.product_line,
    p.type,
    p.category,
    s.name as supplier,
    COUNT(DISTINCT pc.color_id) as color_count,
    MIN(pr.price_cents) as min_price_cents,
    MAX(pr.price_cents) as max_price_cents
FROM products p
JOIN suppliers s ON p.supplier_id = s.id
LEFT JOIN product_colors pc ON p.id = pc.product_id
LEFT JOIN pricing pr ON p.id = pr.product_id AND pr.is_current = 1
WHERE p.is_active = 1
GROUP BY p.id;

-- Popular colors view
CREATE VIEW IF NOT EXISTS popular_colors AS
SELECT 
    c.*,
    s.name as supplier_name,
    COUNT(pc.product_id) as available_in_products
FROM colors c
JOIN suppliers s ON c.supplier_id = s.id
LEFT JOIN product_colors pc ON c.id = pc.color_id
WHERE c.is_popular = 1 AND c.is_active = 1
GROUP BY c.id
ORDER BY c.supplier_id, c.family, c.name;
