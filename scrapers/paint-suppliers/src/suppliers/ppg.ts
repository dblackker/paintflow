import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions } from './base';

export class PPGScraper extends BaseSupplierScraper {
  supplierId = 'ppg';
  supplierName = 'PPG Paints';
  baseUrl = 'https://www.ppgpaints.com';

  private productCategories = [
    { type: 'interior', url: '/products/interior-paint' },
    { type: 'exterior', url: '/products/exterior-paint' },
    { type: 'primer', url: '/products/primers' },
  ];

  async scrapeProducts(options?: ScrapeOptions): Promise<ScrapeResult<Product>> {
    this.logScrapeStart('products');
    const startTime = Date.now();
    const products: Product[] = [];
    const errors: Error[] = [];
    let created = 0, failed = 0;

    try {
      for (const category of this.productCategories) {
        if (options?.types && !options.types.includes(category.type)) continue;

        this.logger.info(`Scraping ${category.type} products...`);
        
        try {
          await this.navigate(`${this.baseUrl}${category.url}`);
          await this.page!.waitForSelector('.product-card, .product-item', { timeout: 10000 });

          // PPG uses a grid layout
          const productLinks = await this.page!.$$eval(
            '.product-card a, .product-item a',
            links => links.map(a => (a as HTMLAnchorElement).href).filter(Boolean)
          );

          this.logger.info(`Found ${productLinks.length} products`);

          for (const link of productLinks.slice(0, options?.limit)) {
            try {
              const product = await this.scrapeProductDetail(link, category.type);
              if (product) {
                products.push(product);
                created++;
              }
            } catch (error) {
              errors.push(error as Error);
              failed++;
            }
            await this.rateLimit();
          }
        } catch (error) {
          errors.push(error as Error);
          this.logger.error(`Failed to scrape category ${category.type}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      this.logScrapeComplete('products', products.length, duration);

      return {
        success: errors.length === 0,
        data: products,
        errors,
        stats: { total: products.length, created, updated: 0, unchanged: 0, failed }
      };
    } catch (error) {
      return {
        success: false,
        data: products,
        errors: [...errors, error as Error],
        stats: { total: products.length, created, updated: 0, unchanged: 0, failed: failed + 1 }
      };
    }
  }

  private async scrapeProductDetail(url: string, type: string): Promise<Product | null> {
    await this.navigate(url);
    
    const productData = await this.page!.$eval('body', () => {
      const name = document.querySelector('h1, .product-title')?.textContent?.trim() || '';
      const sku = document.querySelector('.sku, [data-sku]')?.textContent?.trim() || 
                  document.querySelector('[data-product-id]')?.getAttribute('data-product-id') || '';
      const description = document.querySelector('.product-description, .description')?.textContent?.trim() || '';
      
      // PPG product lines: Manor Hall, Timeless, etc.
      const productLine = document.querySelector('.brand, .collection')?.textContent?.trim() || '';
      
      const sheenElements = document.querySelectorAll('.sheen, [data-sheen]');
      const sheens = Array.from(sheenElements).map(el => el.textContent?.trim()).filter(Boolean) as string[];
      
      return { name, sku, description, productLine, sheens };
    });

    if (!productData.name) return null;

    const sku = productData.sku || this.generateId('ppg', productData.name);
    const id = this.generateId(this.supplierId, sku);

    const product: Product = {
      id,
      supplierId: this.supplierId,
      sku,
      name: productData.name,
      productLine: productData.productLine,
      type: this.normalizeProductType(type),
      description: productData.description,
      sheens: productData.sheens.map(s => this.normalizeSheen(s)),
      url,
    };

    return this.validateProduct(product);
  }

  async scrapePricing(options?: ScrapeOptions): Promise<ScrapeResult<Pricing>> {
    this.logScrapeStart('pricing');
    // PPG pricing often requires store locator or login
    // Return empty for now
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }

  async scrapeColors(options?: ScrapeOptions): Promise<ScrapeResult<Color>> {
    this.logScrapeStart('colors');
    const startTime = Date.now();
    const colors: Color[] = [];
    const errors: Error[] = [];

    try {
      // PPG color palette
      await this.navigate(`${this.baseUrl}/color`);
      await this.page!.waitForSelector('.color-swatch, .color-card', { timeout: 10000 });

      // Get color families
      const families = await this.page!.$$eval(
        '.color-family a, .palette-section a',
        links => links.map(a => ({
          url: (a as HTMLAnchorElement).href,
          name: a.textContent?.trim()
        })).filter(l => l.url)
      );

      this.logger.info(`Found ${families.length} color families`);

      for (const family of families.slice(0, 5)) { // Limit for demo
        try {
          await this.navigate(family.url);
          await this.page!.waitForSelector('.color-swatch', { timeout: 5000 });

          const familyColors = await this.page!.$$eval(
            '.color-swatch',
            (swatches, familyName) => {
              return swatches.map(swatch => {
                const name = swatch.querySelector('.color-name')?.textContent?.trim() || '';
                const code = swatch.querySelector('.color-code')?.textContent?.trim() || '';
                const hex = swatch.getAttribute('data-color') || 
                           (swatch as HTMLElement).style.backgroundColor || '';
                
                return { name, code, hex, family: familyName };
              }).filter(c => c.name);
            },
            family.name
          );

          for (const colorData of familyColors) {
            const id = this.generateId(this.supplierId, colorData.code || colorData.name);
            
            const color: Color = {
              id,
              supplierId: this.supplierId,
              colorCode: colorData.code || id,
              name: colorData.name,
              hexCode: this.normalizeHex(colorData.hex),
              family: colorData.family,
              isPopular: false,
            };

            const validated = this.validateColor(color);
            if (validated) colors.push(validated);
          }

          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
        }
      }

      const duration = Date.now() - startTime;
      this.logScrapeComplete('colors', colors.length, duration);

      return {
        success: errors.length === 0,
        data: colors,
        errors,
        stats: { total: colors.length, created: colors.length, updated: 0, unchanged: 0, failed: errors.length }
      };
    } catch (error) {
      return {
        success: false,
        data: colors,
        errors: [...errors, error as Error],
        stats: { total: colors.length, created: colors.length, updated: 0, unchanged: 0, failed: errors.length + 1 }
      };
    }
  }

  private normalizeHex(hex: string): string | undefined {
    if (!hex) return undefined;
    if (hex.startsWith('#')) return hex.toUpperCase();
    if (hex.startsWith('rgb')) {
      const match = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const r = parseInt(match[1]).toString(16).padStart(2, '0');
        const g = parseInt(match[2]).toString(16).padStart(2, '0');
        const b = parseInt(match[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`.toUpperCase();
      }
    }
    return undefined;
  }
}
