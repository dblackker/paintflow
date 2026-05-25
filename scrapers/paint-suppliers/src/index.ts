import { Command } from 'commander';
import { chromium, Browser, Page } from 'playwright';
import { DatabaseClient } from './db/client';
import { SherwinWilliamsScraper } from './suppliers/sherwin-williams';
import { PPGScraper } from './suppliers/ppg';
import { BenjaminMooreScraper } from './suppliers/benjamin-moore';
import { Logger } from './utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('main');

const program = new Command();

program
  .name('paint-supplier-scraper')
  .description('Scrape paint supplier data for PaintFlow')
  .version('1.0.0');

program
  .command('scrape')
  .description('Scrape supplier data')
  .argument('[supplier]', 'Supplier to scrape (sherwin-williams, ppg, benjamin-moore, or all)')
  .option('--dry-run', 'Don\'t save to database')
  .option('--force', 'Force re-scrape even if recently scraped')
  .option('--limit <number>', 'Limit number of items per category', parseInt)
  .option('--types <types...>', 'Filter by product types')
  .action(async (supplier, options) => {
    const db = new DatabaseClient();
    await db.initialize();
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const scrapers = [];
      
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
        logger.info(`Scraping ${scraper.supplierName}...`);
        await scraper.initialize(page);

        // Scrape products
        const productsResult = await scraper.scrapeProducts({
          dryRun: options.dryRun,
          force: options.force,
          limit: options.limit,
          types: options.types,
        });
        
        if (!options.dryRun && productsResult.success) {
          await db.saveProducts(productsResult.data);
        }
        logger.info(`Products: ${productsResult.stats.created} created, ${productsResult.stats.failed} failed`);

        // Scrape pricing
        const pricingResult = await scraper.scrapePricing({
          dryRun: options.dryRun,
          force: options.force,
        });
        
        if (!options.dryRun && pricingResult.success) {
          await db.savePricing(pricingResult.data);
        }
        logger.info(`Pricing: ${pricingResult.stats.created} created`);

        // Scrape colors
        const colorsResult = await scraper.scrapeColors({
          dryRun: options.dryRun,
          force: options.force,
          limit: options.limit,
        });
        
        if (!options.dryRun && colorsResult.success) {
          await db.saveColors(colorsResult.data);
        }
        logger.info(`Colors: ${colorsResult.stats.created} created`);

        // Scrape product-color mappings
        const mappingsResult = await scraper.scrapeProductColorMappings({
          dryRun: options.dryRun,
          force: options.force,
          limit: options.limit,
        });
        
        if (!options.dryRun && mappingsResult.success) {
          await db.saveProductColors(mappingsResult.data);
        }
        logger.info(`Product-Color Mappings: ${mappingsResult.stats.created} created`);

        // Scrape sundries
        const sundriesResult = await scraper.scrapeSundries({
          dryRun: options.dryRun,
          force: options.force,
        });
        
        if (!options.dryRun && sundriesResult.success) {
          await db.saveSundries(sundriesResult.data);
        }
        logger.info(`Sundries: ${sundriesResult.stats.created} created`);

        await scraper.cleanup();
      }

      logger.info('Scraping complete!');
    } finally {
      await browser.close();
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
