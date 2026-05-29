import 'dotenv/config';
import { Command } from 'commander';
import { chromium, Browser, Page } from 'playwright';
import { DatabaseClient } from './db/client';
import { SherwinWilliamsScraper } from './suppliers/sherwin-williams';
import { PPGScraper } from './suppliers/ppg';
import { BenjaminMooreScraper } from './suppliers/benjamin-moore';
import type { BaseSupplierScraper, ScrapeResult } from './suppliers/base';
import { Logger } from './utils/logger';
import { hydratePostgres } from './hydrate-postgres';
import { baselineCatalog } from './seed/baseline-catalog';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('main');

const program = new Command();

type ScrapeTotals = {
  itemsScraped: number;
  itemsCreated: number;
  itemsUpdated: number;
};

function addResultStats(totals: ScrapeTotals, result: ScrapeResult<unknown>) {
  totals.itemsScraped += result.stats.total;
  totals.itemsCreated += result.stats.created;
  totals.itemsUpdated += result.stats.updated;
}

function resultHasFailures(result: ScrapeResult<unknown>) {
  return !result.success || result.stats.failed > 0 || result.errors.length > 0;
}

async function runSupplierScrape(
  scraper: BaseSupplierScraper,
  browser: Browser,
  db: DatabaseClient,
  options: {
    dryRun?: boolean;
    force?: boolean;
    limit?: number;
    types?: string[];
  }
) {
  logger.info(`Scraping ${scraper.supplierName}...`);
  const totals: ScrapeTotals = { itemsScraped: 0, itemsCreated: 0, itemsUpdated: 0 };
  const context = await browser.newContext();
  const page = await context.newPage();
  const timeoutMs = Number(process.env.SUPPLIER_SCRAPE_TIMEOUT_MS || 240000);
  let timeout: NodeJS.Timeout | null = null;
  let timedOut = false;

  try {
    timeout = setTimeout(() => {
      timedOut = true;
      void context.close().catch(() => undefined);
    }, timeoutMs);
    await performSupplierScrape(scraper, page, db, options, totals, () => timedOut);
  } catch (error) {
    const normalized = timedOut
      ? new Error(`${scraper.supplierName} scrape exceeded ${Math.round(timeoutMs / 1000)} seconds`)
      : error instanceof Error
        ? error
        : new Error(String(error));
    logger.error(`Scrape failed for ${scraper.supplierName}: ${normalized.message}`);
    if (!options.dryRun) {
      await db.logScrape(scraper.supplierId, 'full', 'failed', totals, normalized);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    await context.close().catch(() => undefined);
    await scraper.cleanup();
  }
}

async function performSupplierScrape(
  scraper: BaseSupplierScraper,
  page: Page,
  db: DatabaseClient,
  options: {
    dryRun?: boolean;
    force?: boolean;
    limit?: number;
    types?: string[];
  },
  totals: ScrapeTotals,
  isTimedOut: () => boolean
) {
  let hasFailures = false;

  function throwIfTimedOut() {
    if (isTimedOut()) {
      throw new Error(`${scraper.supplierName} scrape timed out`);
    }
  }

  await scraper.initialize(page);
  throwIfTimedOut();

  const productsResult = await scraper.scrapeProducts({
    dryRun: options.dryRun,
    force: options.force,
    limit: options.limit,
    types: options.types,
  });
  throwIfTimedOut();
  addResultStats(totals, productsResult);
  hasFailures = hasFailures || resultHasFailures(productsResult);
  if (!options.dryRun && productsResult.success) {
    await db.saveProducts(productsResult.data);
  }
  logger.info(`Products: ${productsResult.stats.created} created, ${productsResult.stats.failed} failed`);

  const pricingResult = await scraper.scrapePricing({
    dryRun: options.dryRun,
    force: options.force,
  });
  throwIfTimedOut();
  addResultStats(totals, pricingResult);
  hasFailures = hasFailures || resultHasFailures(pricingResult);
  if (!options.dryRun && pricingResult.success) {
    await db.savePricing(pricingResult.data);
  }
  logger.info(`Pricing: ${pricingResult.stats.created} created, ${pricingResult.stats.failed} failed`);

  const colorsResult = await scraper.scrapeColors({
    dryRun: options.dryRun,
    force: options.force,
    limit: options.limit,
  });
  throwIfTimedOut();
  addResultStats(totals, colorsResult);
  hasFailures = hasFailures || resultHasFailures(colorsResult);
  if (!options.dryRun && colorsResult.success) {
    await db.saveColors(colorsResult.data);
  }
  logger.info(`Colors: ${colorsResult.stats.created} created, ${colorsResult.stats.failed} failed`);

  const mappingsResult = await scraper.scrapeProductColorMappings({
    dryRun: options.dryRun,
    force: options.force,
    limit: options.limit,
  });
  throwIfTimedOut();
  addResultStats(totals, mappingsResult);
  hasFailures = hasFailures || resultHasFailures(mappingsResult);
  if (!options.dryRun && mappingsResult.success) {
    await db.saveProductColors(mappingsResult.data);
  }
  logger.info(`Product-Color Mappings: ${mappingsResult.stats.created} created, ${mappingsResult.stats.failed} failed`);

  const sundriesResult = await scraper.scrapeSundries({
    dryRun: options.dryRun,
    force: options.force,
  });
  throwIfTimedOut();
  addResultStats(totals, sundriesResult);
  hasFailures = hasFailures || resultHasFailures(sundriesResult);
  if (!options.dryRun && sundriesResult.success) {
    await db.saveSundries(sundriesResult.data);
  }
  logger.info(`Sundries: ${sundriesResult.stats.created} created, ${sundriesResult.stats.failed} failed`);

  if (!options.dryRun) {
    await db.logScrape(scraper.supplierId, 'full', hasFailures ? 'partial' : 'success', totals);
  }
}

program
  .name('paint-supplier-scraper')
  .description('Scrape paint supplier data for Crewmodo')
  .version('1.0.0');

program
  .command('scrape')
  .description('Scrape supplier data')
  .argument('[supplier]', 'Supplier to scrape (sherwin-williams, ppg, benjamin-moore, or all)')
  .option('--dry-run', 'Don\'t save to database')
  .option('--force', 'Force re-scrape even if recently scraped')
  .option('--limit <number>', 'Limit number of items per category', parseInt)
  .option('--types <types...>', 'Filter by product types')
  .option('--no-baseline', 'Do not seed baseline products/colors if live scraping captures no catalog data')
  .action(async (supplier, options) => {
    const db = new DatabaseClient();
    await db.initialize();
    
    const browser = await chromium.launch({ headless: true });
    try {
      const scrapers: BaseSupplierScraper[] = [];
      
      if (!supplier || supplier === 'all' || supplier === 'sherwin-williams') {
        scrapers.push(new SherwinWilliamsScraper());
      }
      if (!supplier || supplier === 'all' || supplier === 'ppg') {
        scrapers.push(new PPGScraper());
      }
      if (!supplier || supplier === 'all' || supplier === 'benjamin-moore') {
        scrapers.push(new BenjaminMooreScraper());
      }

      for (const scraper of scrapers) {
        await runSupplierScrape(scraper, browser, db, {
          dryRun: options.dryRun,
          force: options.force,
          limit: options.limit,
          types: options.types,
        });
      }

      if (!options.dryRun && options.baseline !== false) {
        const stats = await db.getStats();
        const requestedSupplierIds = new Set(scrapers.map((scraper) => scraper.supplierId));
        const missingSuppliers = stats.filter((supplier) =>
          requestedSupplierIds.has(supplier.id)
          && Number(supplier.productCount || 0) === 0
          && Number(supplier.colorCount || 0) === 0
        );
        if (missingSuppliers.length > 0) {
          logger.warn(`Live scrape did not capture catalog data for ${missingSuppliers.map((supplier) => supplier.name).join(', ')}. Seeding validated baseline catalog so Crewmodo has usable products and colors.`);
          await seedBaselineCatalog(db);
        }
      }

      logger.info('Scraping complete!');
    } finally {
      await browser.close();
      await db.close();
    }
  });

program
  .command('seed-baseline')
  .description('Seed a validated baseline paint product/color catalog into the local scraper database')
  .action(async () => {
    const db = new DatabaseClient();
    await db.initialize();
    try {
      const result = await seedBaselineCatalog(db);
      logger.info(`Seeded baseline catalog: ${result.products} products, ${result.colors} colors, ${result.productColors} mappings`);
    } finally {
      await db.close();
    }
  });

program
  .command('export')
  .description('Export data to file')
  .option('--format <format>', 'Output format (json, csv)', 'json')
  .option('--supplier <supplier>', 'Filter by supplier')
  .option('--type <type>', 'Filter by product type')
  .option('--output <path>', 'Output file path')
  .action(async (options) => {
    const db = new DatabaseClient();
    await db.initialize();

    try {
      const data = await db.exportData({
        supplier: options.supplier,
        type: options.type,
      });

      const outputPath = options.output || `./exports/export-${Date.now()}.${options.format}`;
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      if (options.format === 'json') {
        await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
      } else if (options.format === 'csv') {
        // Convert to CSV
        const csv = convertToCSV(data);
        await fs.writeFile(outputPath, csv);
      }

      logger.info(`Exported to ${outputPath}`);
    } finally {
      await db.close();
    }
  });

program
  .command('validate')
  .description('Validate scraped data')
  .action(async () => {
    const db = new DatabaseClient();
    await db.initialize();

    try {
      const issues = await db.validateData();
      
      if (issues.length === 0) {
        logger.info('✓ All data valid');
      } else {
        logger.warn(`Found ${issues.length} issues:`);
        issues.forEach(issue => {
          logger.warn(`  [${issue.severity}] ${issue.description}`);
        });
      }
    } finally {
      await db.close();
    }
  });

program
  .command('hydrate-postgres')
  .description('Hydrate Crewmodo Postgres supplier catalog tables from the local scraper database')
  .option('--supplier <supplier>', 'Filter by supplier')
  .option('--type <type>', 'Filter by product type')
  .action(async (options) => {
    const result = await hydratePostgres({
      supplier: options.supplier,
      type: options.type,
    });
    logger.info(`Postgres hydration complete: syncRunId=${result.syncRunId}`);
  });

program
  .command('list')
  .description('List suppliers and stats')
  .action(async () => {
    const db = new DatabaseClient();
    await db.initialize();

    try {
      const stats = await db.getStats();
      
      console.log('\nSupplier Statistics:\n');
      console.log('Supplier'.padEnd(20), 'Products'.padEnd(10), 'Colors'.padEnd(10), 'Last Scraped');
      console.log('-'.repeat(60));
      
      stats.forEach(s => {
        console.log(
          s.name.padEnd(20),
          String(s.productCount).padEnd(10),
          String(s.colorCount).padEnd(10),
          s.lastScraped || 'Never'
        );
      });
      console.log('');
    } finally {
      await db.close();
    }
  });

async function seedBaselineCatalog(db: DatabaseClient) {
  const catalog = baselineCatalog();
  await db.saveProducts(catalog.products);
  await db.savePricing(catalog.pricing);
  await db.saveColors(catalog.colors);
  await db.saveProductColors(catalog.productColors);

  const supplierIds = new Set<string>([
    ...catalog.products.map((product) => product.supplierId),
    ...catalog.colors.map((color) => color.supplierId),
  ]);

  for (const supplierId of supplierIds) {
    const products = catalog.products.filter((product) => product.supplierId === supplierId).length;
    const colors = catalog.colors.filter((color) => color.supplierId === supplierId).length;
    await db.logScrape(supplierId, 'baseline-catalog', 'success', {
      itemsScraped: products + colors,
      itemsCreated: products + colors,
      itemsUpdated: 0,
    });
  }

  return {
    products: catalog.products.length,
    colors: catalog.colors.length,
    productColors: catalog.productColors.length,
  };
}

function convertToCSV(data: any): string {
  // Simple CSV conversion
  if (!Array.isArray(data) || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(h => JSON.stringify(row[h] ?? '')).join(',')
  );
  
  return [headers.join(','), ...rows].join('\n');
}

program.parse();
