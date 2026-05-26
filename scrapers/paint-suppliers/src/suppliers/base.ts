import { Page } from 'playwright';
import { Logger } from '../utils/logger';
import { RetryHelper } from '../utils/retry';
import { z } from 'zod';

// Data schemas
export const ProductSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  sku: z.string(),
  name: z.string(),
  productLine: z.string().optional(),
  type: z.enum(['interior', 'exterior', 'primer', 'specialty', 'stain']),
  category: z.string().optional(),
  sheens: z.array(z.string()).optional(),
  bases: z.array(z.string()).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
});

export const PricingSchema = z.object({
  productId: z.string(),
  size: z.string(),
  priceCents: z.number().int().positive(),
  currency: z.string().default('USD'),
  tier: z.string().default('retail'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const ColorSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  colorCode: z.string(),
  name: z.string(),
  hexCode: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  rgbR: z.number().int().min(0).max(255).optional(),
  rgbG: z.number().int().min(0).max(255).optional(),
  rgbB: z.number().int().min(0).max(255).optional(),
  collection: z.string().optional(),
  family: z.string().optional(),
  lrv: z.number().int().min(0).max(100).optional(),
  isPopular: z.boolean().default(false),
});

export type Product = z.infer<typeof ProductSchema>;
export type Pricing = z.infer<typeof PricingSchema>;
export type Color = z.infer<typeof ColorSchema>;

export interface ScrapeResult<T> {
  success: boolean;
  data: T[];
  errors: Error[];
  stats: {
    total: number;
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
}

export interface ProductColorMapping {
  productId: string;
  colorId: string;
  isAvailable?: boolean;
  baseRequired?: string;
  recommendedUse?: string[]; // ['interior', 'exterior']
  notes?: string;
}

export interface ScrapeOptions {
  force?: boolean; // Force re-scrape even if recently scraped
  dryRun?: boolean; // Don't save to DB
  limit?: number; // Limit number of items
  types?: string[]; // Filter by product types
  includeColorMappings?: boolean; // Also scrape product-color relationships
}

export abstract class BaseSupplierScraper {
  abstract supplierId: string;
  abstract supplierName: string;
  abstract baseUrl: string;
  
  protected logger: Logger;
  protected page: Page | null = null;
  protected rateLimitMs: number = 1000;
  
  constructor() {
    this.logger = new Logger('scraper');
  }

  // Must be implemented by subclasses
  abstract scrapeProducts(options?: ScrapeOptions): Promise<ScrapeResult<Product>>;
  abstract scrapePricing(options?: ScrapeOptions): Promise<ScrapeResult<Pricing>>;
  abstract scrapeColors(options?: ScrapeOptions): Promise<ScrapeResult<Color>>;
  
  // Optional: Override to scrape product-color relationships
  async scrapeProductColorMappings(options?: ScrapeOptions): Promise<ScrapeResult<ProductColorMapping>> {
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }
  
  // Optional: Override if supplier has sundries
  async scrapeSundries(options?: ScrapeOptions): Promise<ScrapeResult<any>> {
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }

  // Initialize Playwright page
  async initialize(page: Page): Promise<void> {
    this.page = page;
    await this.setupPage();
  }

  protected async setupPage(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    // Set user agent
    await this.page.setExtraHTTPHeaders({
      'User-Agent': this.getRandomUserAgent(),
    });
    
    // Set viewport
    await this.page.setViewportSize({ width: 1920, height: 1080 });
    
    // Block unnecessary resources
    await this.page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  // Navigate with retry logic
  protected async navigate(url: string, retries = 3): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    await RetryHelper.withRetry(
      async () => {
        await this.page!.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        await this.rateLimit();
      },
      { maxRetries: retries, delayMs: 2000 }
    );
  }

  // Rate limiting
  protected async rateLimit(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.rateLimitMs));
  }

  // Extract with error handling
  protected async extract<T>(
    extractor: () => Promise<T>,
    context: string
  ): Promise<T | null> {
    try {
      return await extractor();
    } catch (error) {
      this.logger.warn(`Extraction failed for ${context}:`, error);
      return null;
    }
  }

  // Normalize product type
  protected normalizeProductType(rawType: string): 'interior' | 'exterior' | 'primer' | 'specialty' | 'stain' {
    const lower = rawType.toLowerCase();
    if (lower.includes('interior') || lower.includes('inside')) return 'interior';
    if (lower.includes('exterior') || lower.includes('outside')) return 'exterior';
    if (lower.includes('primer') || lower.includes('sealer')) return 'primer';
    if (lower.includes('stain')) return 'stain';
    return 'specialty';
  }

  // Normalize sheen names
  protected normalizeSheen(sheen: string): string {
    const map: Record<string, string> = {
      'flat': 'flat',
      'matte': 'flat',
      'eggshell': 'eggshell',
      'satin': 'satin',
      'pearl': 'satin',
      'semi-gloss': 'semi-gloss',
      'semigloss': 'semi-gloss',
      'gloss': 'gloss',
      'high-gloss': 'gloss',
    };
    return map[sheen.toLowerCase().trim()] || sheen.toLowerCase().trim();
  }

  // Parse price string to cents
  protected parsePrice(priceStr: string): number | null {
    // Remove currency symbols and commas
    const cleaned = priceStr.replace(/[$,]/g, '').trim();
    const match = cleaned.match(/(\d+\.?\d*)/);
    if (!match) return null;
    
    const dollars = parseFloat(match[1]);
    return Math.round(dollars * 100);
  }

  // Generate deterministic ID
  protected generateId(...parts: string[]): string {
    return parts
      .map(p => p.toLowerCase().replace(/[^a-z0-9]/g, '-'))
      .join(':');
  }

  // Get random user agent
  protected getRandomUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // Validate data with Zod
  protected validateProduct(data: any): Product | null {
    try {
      return ProductSchema.parse(data);
    } catch (error) {
      this.logger.warn('Product validation failed:', error);
      return null;
    }
  }

  protected validatePricing(data: any): Pricing | null {
    try {
      return PricingSchema.parse(data);
    } catch (error) {
      this.logger.warn('Pricing validation failed:', error);
      return null;
    }
  }

  protected validateColor(data: any): Color | null {
    try {
      return ColorSchema.parse(data);
    } catch (error) {
      this.logger.warn('Color validation failed:', error);
      return null;
    }
  }

  // Cleanup
  async cleanup(): Promise<void> {
    // Override in subclasses if needed
  }

  // Log scrape start
  protected logScrapeStart(type: string): void {
    this.logger.info(`Starting ${type} scrape for ${this.supplierName}`);
  }

  // Log scrape complete
  protected logScrapeComplete(type: string, count: number, durationMs: number): void {
    this.logger.info(
      `Completed ${type} scrape for ${this.supplierName}: ${count} items in ${durationMs}ms`
    );
  }
}
