import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { DatabaseClient, SupplierCatalogExport } from './db/client';
import { Logger } from './utils/logger';

const logger = new Logger('hydrate-postgres');

type Queryable = Pick<Pool | PoolClient, 'query'>;

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function nullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  const text = nullableText(value);
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function requiredText(value: unknown, maxLength: number, fallback: string): string {
  return boundedText(value, maxLength) || fallback.slice(0, maxLength);
}

function stableCatalogId(value: unknown, maxLength = 255): string {
  const text = String(value ?? '').trim();
  if (!text) return createHash('sha256').update('missing-catalog-id').digest('hex');
  if (text.length <= maxLength) return text;

  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const prefixLength = Math.max(0, maxLength - hash.length - 1);
  return `${text.slice(0, prefixLength)}-${hash}`;
}

function issuePayload(catalog: SupplierCatalogExport) {
  return catalog.issues.map((issue) => ({
    supplierId: issue.supplierId,
    issueType: issue.issueType,
    severity: issue.severity,
    entityType: issue.entityType,
    entityId: issue.entityId,
    description: issue.description,
  }));
}

async function startSyncRun(client: Queryable, catalog: SupplierCatalogExport) {
  const suppliers = catalog.suppliers.map((supplier) => supplier.id);
  const result = await client.query<{ id: string }>(
    `INSERT INTO supplier_catalog_sync_runs (status, suppliers, issues)
     VALUES ('running', $1::jsonb, $2::jsonb)
     RETURNING id`,
    [JSON.stringify(suppliers), JSON.stringify(issuePayload(catalog))]
  );
  return result.rows[0].id;
}

async function ensureCatalogColumnCapacity(client: Queryable) {
  await client.query(`
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
  `);
}

async function finishSyncRun(
  client: Queryable,
  syncRunId: string,
  status: 'success' | 'partial' | 'failed',
  stats: { products: number; colors: number; productColors: number },
  issues: unknown[]
) {
  await client.query(
    `UPDATE supplier_catalog_sync_runs
     SET status = $2,
         products_upserted = $3,
         colors_upserted = $4,
         product_colors_upserted = $5,
         issues = $6::jsonb,
         finished_at = NOW()
     WHERE id = $1`,
    [syncRunId, status, stats.products, stats.colors, stats.productColors, JSON.stringify(issues)]
  );
}

async function upsertProducts(client: PoolClient, catalog: SupplierCatalogExport) {
  let count = 0;
  for (const product of catalog.products) {
    await client.query(
      `INSERT INTO supplier_catalog_products (
        supplier_id, supplier_name, external_id, sku, name, product_line, type, category,
        sheens, bases, description, features, url, image_url, size, price_cents, currency,
        pricing_tier, coverage_sq_ft_min, coverage_sq_ft_max, last_seen_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16, $17,
        $18, $19, $20, COALESCE($21::timestamp, NOW()), NOW()
      )
      ON CONFLICT (supplier_id, external_id) DO UPDATE SET
        supplier_name = EXCLUDED.supplier_name,
        sku = EXCLUDED.sku,
        name = EXCLUDED.name,
        product_line = EXCLUDED.product_line,
        type = EXCLUDED.type,
        category = EXCLUDED.category,
        sheens = EXCLUDED.sheens,
        bases = EXCLUDED.bases,
        description = EXCLUDED.description,
        features = EXCLUDED.features,
        url = EXCLUDED.url,
        image_url = EXCLUDED.image_url,
        size = EXCLUDED.size,
        price_cents = EXCLUDED.price_cents,
        currency = EXCLUDED.currency,
        pricing_tier = EXCLUDED.pricing_tier,
        coverage_sq_ft_min = EXCLUDED.coverage_sq_ft_min,
        coverage_sq_ft_max = EXCLUDED.coverage_sq_ft_max,
        is_active = TRUE,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = NOW()`,
      [
        requiredText(product.supplierId, 80, 'unknown'),
        requiredText(product.supplierName, 255, 'Unknown supplier'),
        stableCatalogId(product.id),
        boundedText(product.sku, 120),
        requiredText(product.name, 255, 'Unnamed product'),
        boundedText(product.productLine, 255),
        requiredText(product.type, 60, 'paint'),
        boundedText(product.category, 100),
        JSON.stringify(parseJsonArray(product.sheens)),
        JSON.stringify(parseJsonArray(product.bases)),
        nullableText(product.description),
        JSON.stringify(parseJsonArray(product.features)),
        nullableText(product.url),
        nullableText(product.imageUrl),
        boundedText(product.size, 80),
        product.priceCents == null ? null : Number(product.priceCents),
        boundedText(product.currency, 10) || 'USD',
        boundedText(product.pricingTier, 80) || 'retail',
        product.coverageSqFtMin == null ? null : Number(product.coverageSqFtMin),
        product.coverageSqFtMax == null ? null : Number(product.coverageSqFtMax),
        nullableText(product.lastSeenAt),
      ]
    );
    count += 1;
  }
  return count;
}

async function upsertColors(client: PoolClient, catalog: SupplierCatalogExport) {
  let count = 0;
  for (const color of catalog.colors) {
    await client.query(
      `INSERT INTO supplier_catalog_colors (
        supplier_id, supplier_name, external_id, color_code, name, hex_code,
        rgb_r, rgb_g, rgb_b, collection, family, lrv, is_popular, last_seen_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      ON CONFLICT (supplier_id, external_id) DO UPDATE SET
        supplier_name = EXCLUDED.supplier_name,
        color_code = EXCLUDED.color_code,
        name = EXCLUDED.name,
        hex_code = EXCLUDED.hex_code,
        rgb_r = EXCLUDED.rgb_r,
        rgb_g = EXCLUDED.rgb_g,
        rgb_b = EXCLUDED.rgb_b,
        collection = EXCLUDED.collection,
        family = EXCLUDED.family,
        lrv = EXCLUDED.lrv,
        is_popular = EXCLUDED.is_popular,
        is_active = TRUE,
        last_seen_at = NOW(),
        updated_at = NOW()`,
      [
        requiredText(color.supplierId, 80, 'unknown'),
        requiredText(color.supplierName, 255, 'Unknown supplier'),
        stableCatalogId(color.id),
        requiredText(color.colorCode, 100, stableCatalogId(color.id, 100)),
        requiredText(color.name, 255, 'Unnamed color'),
        boundedText(color.hexCode, 7),
        color.rgbR == null ? null : Number(color.rgbR),
        color.rgbG == null ? null : Number(color.rgbG),
        color.rgbB == null ? null : Number(color.rgbB),
        boundedText(color.collection, 255),
        boundedText(color.family, 100),
        color.lrv == null ? null : Number(color.lrv),
        bool(color.isPopular),
      ]
    );
    count += 1;
  }
  return count;
}

async function upsertProductColors(client: PoolClient, catalog: SupplierCatalogExport) {
  let count = 0;
  for (const mapping of catalog.productColors) {
    await client.query(
      `INSERT INTO supplier_catalog_product_colors (
        product_id, color_id, supplier_id, is_available, base_required, recommended_use, last_seen_at, updated_at
      )
      SELECT p.id, c.id, $1::varchar, $2, $3, $4::jsonb, NOW(), NOW()
      FROM supplier_catalog_products p
      JOIN supplier_catalog_colors c
        ON c.supplier_id = p.supplier_id
       AND c.external_id = $6
      WHERE p.supplier_id = $1::varchar
        AND p.external_id = $5
      ON CONFLICT (product_id, color_id) DO UPDATE SET
        is_available = EXCLUDED.is_available,
        base_required = EXCLUDED.base_required,
        recommended_use = EXCLUDED.recommended_use,
        last_seen_at = NOW(),
        updated_at = NOW()`,
      [
        requiredText(mapping.supplierId, 80, 'unknown'),
        mapping.isAvailable !== 0,
        boundedText(mapping.baseRequired, 120),
        JSON.stringify(parseJsonArray(mapping.recommendedUse)),
        stableCatalogId(mapping.productId),
        stableCatalogId(mapping.colorId),
      ]
    );
    count += 1;
  }
  return count;
}

export async function hydratePostgres(options: { supplier?: string; type?: string } = {}) {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required to hydrate the supplier catalog');
  }

  const sqlite = new DatabaseClient();
  await sqlite.initialize();
  const catalog = await sqlite.exportCatalog(options);
  await sqlite.close();

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
  let syncRunId: string | null = null;
  let client: PoolClient | null = null;

  try {
    await ensureCatalogColumnCapacity(pool);
    syncRunId = await startSyncRun(pool, catalog);
    client = await pool.connect();
    await client.query('BEGIN');
    const products = await upsertProducts(client, catalog);
    const colors = await upsertColors(client, catalog);
    const productColors = await upsertProductColors(client, catalog);
    const issues = issuePayload(catalog);
    const status = issues.some((issue) => ['high', 'critical'].includes(issue.severity)) ? 'partial' : 'success';
    await client.query('COMMIT');
    await finishSyncRun(pool, syncRunId, status, { products, colors, productColors }, issues);

    logger.info(`Hydrated supplier catalog: ${products} products, ${colors} colors, ${productColors} product-color mappings`);
    return { syncRunId, products, colors, productColors, issues };
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    if (syncRunId) {
      await finishSyncRun(pool, syncRunId, 'failed', { products: 0, colors: 0, productColors: 0 }, [
        { severity: 'critical', description: error instanceof Error ? error.message : String(error) },
      ]);
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}
