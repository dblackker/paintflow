import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Product, Pricing, Color } from '../suppliers/base';
import { Logger } from '../utils/logger';

export interface ExportOptions {
  supplier?: string;
  type?: string;
}

export interface DataIssue {
  supplierId: string;
  issueType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType?: string;
  entityId?: string;
  description: string;
}

export interface SupplierCatalogExport {
  suppliers: Array<{
    id: string;
    name: string;
    website: string;
    lastScrapedAt?: string | null;
    lastSuccessfulScrapeAt?: string | null;
  }>;
  products: Array<Record<string, any>>;
  colors: Array<Record<string, any>>;
  productColors: Array<Record<string, any>>;
  issues: DataIssue[];
}

export class DatabaseClient {
  private db: Database | null = null;
  private logger: Logger;
  private dbPath: string;

  constructor() {
    this.logger = new Logger('database');
    this.dbPath = process.env.DATABASE_PATH || './data/suppliers.db';
  }

  async initialize(): Promise<void> {
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });

    // Open database
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    // Enable foreign keys
    await this.db.exec('PRAGMA foreign_keys = ON;');
    
    // Load schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sourceSchemaPath = path.resolve(__dirname, '../../src/db/schema.sql');
    const cwdSchemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8')
      .catch(() => fs.readFile(sourceSchemaPath, 'utf-8'))
      .catch(() => fs.readFile(cwdSchemaPath, 'utf-8'));
    await this.db.exec(schema);

    // Insert suppliers if not exists
    await this.initializeSuppliers();

    this.logger.info(`Database initialized at ${this.dbPath}`);
  }

  private async initializeSuppliers(): Promise<void> {
    const suppliers = [
      {
        id: 'sherwin-williams',
        name: 'Sherwin-Williams',
        website: 'https://www.sherwin-williams.com',
        config: JSON.stringify({ scrapeProducts: true, scrapeColors: true }),
      },
      {
        id: 'ppg',
        name: 'PPG Paints',
        website: 'https://www.ppgpaints.com',
        config: JSON.stringify({ scrapeProducts: true, scrapeColors: true }),
      },
      {
        id: 'benjamin-moore',
        name: 'Benjamin Moore',
        website: 'https://www.benjaminmoore.com',
        config: JSON.stringify({ scrapeProducts: true, scrapeColors: true }),
      },
    ];

    for (const supplier of suppliers) {
      await this.db!.run(
        `INSERT OR IGNORE INTO suppliers (id, name, website, config_json) VALUES (?, ?, ?, ?)`,
        [supplier.id, supplier.name, supplier.website, supplier.config]
      );
    }
  }

  async saveProducts(products: Product[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const product of products) {
      await this.db.run(
        `INSERT OR REPLACE INTO products (
          id, supplier_id, sku, name, product_line, type, category, 
          sheens, bases, description, features, url, image_url, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          product.id,
          product.supplierId,
          product.sku,
          product.name,
          product.productLine || null,
          product.type,
          product.category || null,
          product.sheens ? JSON.stringify(product.sheens) : null,
          product.bases ? JSON.stringify(product.bases) : null,
          product.description || null,
          product.features ? JSON.stringify(product.features) : null,
          product.url || null,
          product.imageUrl || null,
        ]
      );
    }

    this.logger.info(`Saved ${products.length} products`);
  }

  async savePricing(pricing: Pricing[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const price of pricing) {
      // Mark old pricing as not current
      await this.db.run(
        `UPDATE pricing SET is_current = 0 WHERE product_id = ? AND size = ? AND tier = ?`,
        [price.productId, price.size, price.tier]
      );

      // Insert new pricing
      await this.db.run(
        `INSERT INTO pricing (product_id, size, price_cents, currency, tier, effective_date, is_current)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          price.productId,
          price.size,
          price.priceCents,
          price.currency,
          price.tier,
          price.effectiveDate,
        ]
      );
    }

    this.logger.info(`Saved ${pricing.length} pricing records`);
  }

  async saveColors(colors: Color[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const color of colors) {
      await this.db.run(
        `INSERT OR REPLACE INTO colors (
          id, supplier_id, color_code, name, hex_code, rgb_r, rgb_g, rgb_b,
          collection, family, lrv, is_popular, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          color.id,
          color.supplierId,
          color.colorCode,
          color.name,
          color.hexCode || null,
          color.rgbR || null,
          color.rgbG || null,
          color.rgbB || null,
          color.collection || null,
          color.family || null,
          color.lrv || null,
          color.isPopular ? 1 : 0,
        ]
      );
    }

    this.logger.info(`Saved ${colors.length} colors`);
  }

  async saveProductColors(productColorMappings: Array<{
    productId: string;
    colorId: string;
    isAvailable?: boolean;
    baseRequired?: string;
    recommendedUse?: string[];
  }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const mapping of productColorMappings) {
      await this.db.run(
        `INSERT OR REPLACE INTO product_colors (
          product_id, color_id, is_available, base_required, recommended_use
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          mapping.productId,
          mapping.colorId,
          mapping.isAvailable !== false ? 1 : 0,
          mapping.baseRequired || null,
          mapping.recommendedUse ? JSON.stringify(mapping.recommendedUse) : null,
        ]
      );
    }

    this.logger.info(`Saved ${productColorMappings.length} product-color relationships`);
  }

  async getColorsForProduct(productId: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const colors = await this.db.all(
      `SELECT c.*, pc.base_required, pc.recommended_use, pc.is_available
       FROM colors c
       JOIN product_colors pc ON c.id = pc.color_id
       WHERE pc.product_id = ? AND pc.is_available = 1
       ORDER BY c.family, c.name`,
      [productId]
    );

    return colors;
  }

  async getProductsForColor(colorId: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const products = await this.db.all(
      `SELECT p.*, pc.base_required, pc.recommended_use
       FROM products p
       JOIN product_colors pc ON p.id = pc.product_id
       WHERE pc.color_id = ? AND pc.is_available = 1 AND p.is_active = 1
       ORDER BY p.product_line, p.name`,
      [colorId]
    );

    return products;
  }

  async saveSundries(sundries: any[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const item of sundries) {
      await this.db.run(
        `INSERT OR REPLACE INTO sundries (
          id, supplier_id, sku, name, category, subcategory, description,
          price_cents, size, material, url, image_url, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          item.id,
          item.supplierId,
          item.sku,
          item.name,
          item.category,
          item.subcategory || null,
          item.description || null,
          item.priceCents || null,
          item.size || null,
          item.material || null,
          item.url || null,
          item.imageUrl || null,
        ]
      );
    }

    this.logger.info(`Saved ${sundries.length} sundries`);
  }

  async logScrape(
    supplierId: string,
    scrapeType: string,
    status: string,
    stats: { itemsScraped: number; itemsCreated: number; itemsUpdated: number },
    error?: Error
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      `INSERT INTO scrape_logs (
        supplier_id, scrape_type, started_at, finished_at, status,
        items_scraped, items_created, items_updated, error_message
      ) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
      [
        supplierId,
        scrapeType,
        status,
        stats.itemsScraped,
        stats.itemsCreated,
        stats.itemsUpdated,
        error?.message || null,
      ]
    );

    // Update supplier last_scraped_at
    await this.db.run(
      `UPDATE suppliers SET last_scraped_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [supplierId]
    );

    if (status === 'success') {
      await this.db.run(
        `UPDATE suppliers SET last_successful_scrape_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [supplierId]
      );
    }
  }

  async exportData(options: ExportOptions): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = `
      SELECT 
        p.id, p.name, p.product_line, p.type, p.category,
        s.name as supplier,
        pr.size, pr.price_cents, pr.tier,
        c.name as color_name, c.hex_code
      FROM products p
      JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN pricing pr ON p.id = pr.product_id AND pr.is_current = 1
      LEFT JOIN product_colors pc ON p.id = pc.product_id
      LEFT JOIN colors c ON pc.color_id = c.id
      WHERE p.is_active = 1
    `;

    const params: any[] = [];

    if (options.supplier) {
      query += ` AND p.supplier_id = ?`;
      params.push(options.supplier);
    }

    if (options.type) {
      query += ` AND p.type = ?`;
      params.push(options.type);
    }

    const rows = await this.db.all(query, params);
    return rows;
  }

  async exportCatalog(options: ExportOptions = {}): Promise<SupplierCatalogExport> {
    if (!this.db) throw new Error('Database not initialized');

    const params: any[] = [];
    const supplierFilter = options.supplier ? 'WHERE s.id = ?' : '';
    if (options.supplier) params.push(options.supplier);

    const suppliers = await this.db.all(
      `SELECT
        s.id,
        s.name,
        s.website,
        s.last_scraped_at as lastScrapedAt,
        s.last_successful_scrape_at as lastSuccessfulScrapeAt
       FROM suppliers s
       ${supplierFilter}
       ORDER BY s.name`,
      params
    );

    const productParams: any[] = [];
    let productFilter = 'WHERE p.is_active = 1';
    if (options.supplier) {
      productFilter += ' AND p.supplier_id = ?';
      productParams.push(options.supplier);
    }
    if (options.type) {
      productFilter += ' AND p.type = ?';
      productParams.push(options.type);
    }

    const products = await this.db.all(
      `SELECT
        p.id,
        p.supplier_id as supplierId,
        s.name as supplierName,
        p.sku,
        p.name,
        p.product_line as productLine,
        p.type,
        p.category,
        p.sheens,
        p.bases,
        p.description,
        p.features,
        p.url,
        p.image_url as imageUrl,
        p.last_seen_at as lastSeenAt,
        pr.size,
        pr.price_cents as priceCents,
        pr.currency,
        pr.tier as pricingTier,
        spec.coverage_rate_sqft_per_gal_min as coverageSqFtMin,
        spec.coverage_rate_sqft_per_gal_max as coverageSqFtMax
       FROM products p
       JOIN suppliers s ON p.supplier_id = s.id
       LEFT JOIN pricing pr ON p.id = pr.product_id AND pr.is_current = 1
       LEFT JOIN specifications spec ON p.id = spec.product_id
       ${productFilter}
       ORDER BY s.name, p.product_line, p.name`,
      productParams
    );

    const colors = await this.db.all(
      `SELECT
        c.id,
        c.supplier_id as supplierId,
        s.name as supplierName,
        c.color_code as colorCode,
        c.name,
        c.hex_code as hexCode,
        c.rgb_r as rgbR,
        c.rgb_g as rgbG,
        c.rgb_b as rgbB,
        c.collection,
        c.family,
        c.lrv,
        c.is_popular as isPopular
       FROM colors c
       JOIN suppliers s ON c.supplier_id = s.id
       WHERE c.is_active = 1
       ${options.supplier ? 'AND c.supplier_id = ?' : ''}
       ORDER BY s.name, c.family, c.name`,
      options.supplier ? [options.supplier] : []
    );

    const productColors = await this.db.all(
      `SELECT
        pc.product_id as productId,
        pc.color_id as colorId,
        p.supplier_id as supplierId,
        pc.is_available as isAvailable,
        pc.base_required as baseRequired,
        pc.recommended_use as recommendedUse
       FROM product_colors pc
       JOIN products p ON pc.product_id = p.id
       WHERE pc.is_available = 1
       ${options.supplier ? 'AND p.supplier_id = ?' : ''}`,
      options.supplier ? [options.supplier] : []
    );

    return {
      suppliers,
      products,
      colors,
      productColors,
      issues: await this.validateData(),
    };
  }

  async getStats(): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stats = await this.db.all(`
      SELECT 
        s.id,
        s.name,
        s.last_scraped_at,
        s.last_successful_scrape_at,
        COUNT(DISTINCT p.id) as productCount,
        COUNT(DISTINCT c.id) as colorCount,
        COUNT(DISTINCT su.id) as sundryCount
      FROM suppliers s
      LEFT JOIN products p ON s.id = p.supplier_id AND p.is_active = 1
      LEFT JOIN colors c ON s.id = c.supplier_id AND c.is_active = 1
      LEFT JOIN sundries su ON s.id = su.supplier_id AND su.is_active = 1
      GROUP BY s.id
    `);

    return stats;
  }

  async validateData(): Promise<DataIssue[]> {
    if (!this.db) throw new Error('Database not initialized');

    const issues: DataIssue[] = [];

    // Check for products without pricing
    const productsWithoutPricing = await this.db.all(`
      SELECT p.id, p.name, p.supplier_id
      FROM products p
      LEFT JOIN pricing pr ON p.id = pr.product_id AND pr.is_current = 1
      WHERE p.is_active = 1 AND pr.id IS NULL
    `);

    for (const product of productsWithoutPricing) {
      issues.push({
        supplierId: product.supplier_id,
        issueType: 'missing_price',
        severity: 'medium',
        entityType: 'product',
        entityId: product.id,
        description: `Product "${product.name}" has no current pricing`,
      });
    }

    // Check for colors without hex codes
    const colorsWithoutHex = await this.db.all(`
      SELECT id, name, supplier_id
      FROM colors
      WHERE is_active = 1 AND hex_code IS NULL
    `);

    for (const color of colorsWithoutHex) {
      issues.push({
        supplierId: color.supplier_id,
        issueType: 'missing_hex',
        severity: 'low',
        entityType: 'color',
        entityId: color.id,
        description: `Color "${color.name}" missing hex code`,
      });
    }

    // Check for stale data (not scraped in 14 days)
    const staleSuppliers = await this.db.all(`
      SELECT id, name, last_successful_scrape_at
      FROM suppliers
      WHERE last_successful_scrape_at < datetime('now', '-14 days')
         OR last_successful_scrape_at IS NULL
    `);

    for (const supplier of staleSuppliers) {
      issues.push({
        supplierId: supplier.id,
        issueType: 'stale_data',
        severity: 'high',
        description: `Supplier "${supplier.name}" not scraped in 14+ days`,
      });
    }

    return issues;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
