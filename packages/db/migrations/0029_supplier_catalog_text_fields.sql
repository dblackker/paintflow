ALTER TABLE supplier_catalog_products
  ALTER COLUMN supplier_name TYPE TEXT,
  ALTER COLUMN external_id TYPE TEXT,
  ALTER COLUMN sku TYPE TEXT,
  ALTER COLUMN name TYPE TEXT,
  ALTER COLUMN product_line TYPE TEXT,
  ALTER COLUMN type TYPE TEXT,
  ALTER COLUMN category TYPE TEXT,
  ALTER COLUMN description TYPE TEXT,
  ALTER COLUMN size TYPE TEXT,
  ALTER COLUMN currency TYPE TEXT,
  ALTER COLUMN pricing_tier TYPE TEXT;

ALTER TABLE supplier_catalog_colors
  ALTER COLUMN supplier_name TYPE TEXT,
  ALTER COLUMN external_id TYPE TEXT,
  ALTER COLUMN color_code TYPE TEXT,
  ALTER COLUMN name TYPE TEXT,
  ALTER COLUMN collection TYPE TEXT,
  ALTER COLUMN family TYPE TEXT;

ALTER TABLE supplier_catalog_product_colors
  ALTER COLUMN base_required TYPE TEXT;
