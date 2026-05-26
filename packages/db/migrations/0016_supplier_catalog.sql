CREATE TABLE IF NOT EXISTS supplier_catalog_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  source TEXT NOT NULL DEFAULT 'paint_supplier_scraper',
  status VARCHAR(40) NOT NULL DEFAULT 'running',
  suppliers JSONB NOT NULL DEFAULT '[]'::jsonb,
  products_upserted INTEGER NOT NULL DEFAULT 0,
  colors_upserted INTEGER NOT NULL DEFAULT 0,
  product_colors_upserted INTEGER NOT NULL DEFAULT 0,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  supplier_id VARCHAR(80) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  sku VARCHAR(120),
  name VARCHAR(255) NOT NULL,
  product_line VARCHAR(255),
  type VARCHAR(60) NOT NULL,
  category VARCHAR(100),
  sheens JSONB NOT NULL DEFAULT '[]'::jsonb,
  bases JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  url TEXT,
  image_url TEXT,
  size VARCHAR(80),
  price_cents INTEGER,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  pricing_tier VARCHAR(80) NOT NULL DEFAULT 'retail',
  coverage_sq_ft_min INTEGER,
  coverage_sq_ft_max INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, external_id)
);

CREATE TABLE IF NOT EXISTS supplier_catalog_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  supplier_id VARCHAR(80) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  color_code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  hex_code VARCHAR(7),
  rgb_r INTEGER,
  rgb_g INTEGER,
  rgb_b INTEGER,
  collection VARCHAR(255),
  family VARCHAR(100),
  lrv INTEGER,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, external_id)
);

CREATE TABLE IF NOT EXISTS supplier_catalog_product_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  product_id UUID NOT NULL REFERENCES supplier_catalog_products(id) ON DELETE CASCADE,
  color_id UUID NOT NULL REFERENCES supplier_catalog_colors(id) ON DELETE CASCADE,
  supplier_id VARCHAR(80) NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  base_required VARCHAR(120),
  recommended_use JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, color_id)
);

CREATE INDEX IF NOT EXISTS supplier_catalog_products_supplier_idx ON supplier_catalog_products (supplier_id, is_active);
CREATE INDEX IF NOT EXISTS supplier_catalog_products_type_idx ON supplier_catalog_products (type, category);
CREATE INDEX IF NOT EXISTS supplier_catalog_products_search_idx ON supplier_catalog_products (name, product_line);
CREATE INDEX IF NOT EXISTS supplier_catalog_colors_supplier_idx ON supplier_catalog_colors (supplier_id, is_active);
CREATE INDEX IF NOT EXISTS supplier_catalog_colors_family_idx ON supplier_catalog_colors (family, is_popular);
CREATE INDEX IF NOT EXISTS supplier_catalog_product_colors_product_idx ON supplier_catalog_product_colors (product_id, is_available);
CREATE INDEX IF NOT EXISTS supplier_catalog_product_colors_color_idx ON supplier_catalog_product_colors (color_id, is_available);
CREATE INDEX IF NOT EXISTS supplier_catalog_sync_runs_started_idx ON supplier_catalog_sync_runs (started_at DESC);

ALTER TABLE supplier_catalog_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalog_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalog_product_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_catalog_sync_runs_global_or_org ON supplier_catalog_sync_runs
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY supplier_catalog_products_global_or_org ON supplier_catalog_products
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY supplier_catalog_colors_global_or_org ON supplier_catalog_colors
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY supplier_catalog_product_colors_global_or_org ON supplier_catalog_product_colors
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid);
