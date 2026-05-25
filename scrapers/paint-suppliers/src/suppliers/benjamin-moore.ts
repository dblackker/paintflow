import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions } from './base';

export class BenjaminMooreScraper extends BaseSupplierScraper {
  supplierId = 'benjamin-moore';
  supplierName = 'Benjamin Moore';
  baseUrl = 'https://www.benjaminmoore.com';

  private productCategories = [
    { type: 'interior', url: '/en-us/interior-paints-stains' },
    { type: 'exterior', url: '/en-us/exterior-paints-stains' },
    { type: 'primer', url: '/en-us/primers' },
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
          
          // Benjamin Moore uses React with data attributes
          await this.page!.waitForSelector('[data-testid="product-card"], .product-tile', { timeout: 15000 });

          // Scroll to load all products
          await this.page!.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await this.page!.waitForTimeout(2000);

          const productLinks = await this.page!.$$eval(
            '[data-testid="product-card"] a, .product-tile a, [href*="/product/"]',
            links => [...new Set(links.map(a => (a as HTMLAnchorElement).href))].filter(Boolean)
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
              this.logger.warn(`Failed to scrape product:`, error);
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
    
    // Wait for product details to load
    await this.page!.waitForSelector('h1, [data-testid="product-name"]', { timeout: 10000 });

    const productData = await this.page!.$eval('body', () => {
      // Try multiple selectors
      const name = document.querySelector('h1, [data-testid="product-name"], .product-name')?.textContent?.trim() || '';
      
      // SKU might be in meta or product info section
      const sku = document.querySelector('[data-sku], .sku, [itemprop="sku"]')?.textContent?.trim() ||
                  document.querySelector('meta[itemprop="sku"]')?.getAttribute('content') || '';
      
      const description = document.querySelector('[data-testid="product-description"], .product-description, [itemprop="description"]')?.textContent?.trim() || '';
      
      // Product line - Benjamin Moore has lines like "Regal Select", "Aura", "ben"
      const productLine = document.querySelector('.product-line, .collection-name, [data-collection]')?.textContent?.trim() || '';
      
      // Sheens
      const sheenElements = document.querySelectorAll('[data-sheen], .sheen-option');
      const sheens = Array.from(sheenElements)
        .map(el => el.textContent?.trim() || el.getAttribute('data-sheen'))
        .filter(Boolean) as string[];
      
      // Features/benefits
      const features = Array.from(document.querySelectorAll('.feature, .benefit, [data-feature]'))
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];
      
      // Image
      const imageUrl = document.querySelector('[itemprop="image"], .product-image img')?.getAttribute('src') || '';
      
      return { name, sku, description, productLine, sheens, features, imageUrl };
    });

    if (!productData.name) return null;

    const sku = productData.sku || this.generateId('bm', productData.name);
    const id = this.generateId(this.supplierId, sku);

    const product: Product = {
      id,
      supplierId: this.supplierId,
      sku,
      name: productData.name,
      productLine: productData.productLine,
      type: this.normalizeProductType(type),
      description: productData.description,
      features: productData.features,
      sheens: productData.sheens.map(s => this.normalizeSheen(s)),
      imageUrl: productData.imageUrl ? new URL(productData.imageUrl, this.baseUrl).toString() : undefined,
      url,
    };

    return this.validateProduct(product);
  }

  async scrapePricing(options?: ScrapeOptions): Promise<ScrapeResult<Pricing>> {
    this.logScrapeStart('pricing');
    // Benjamin Moore pricing is retailer-specific, not shown online
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
      // Benjamin Moore color families
      await this.navigate(`${this.baseUrl}/en-us/color-overview`);
      await this.page!.waitForSelector('[href*="/color/"]', { timeout: 10000 });

      // Get color family links
      const familyLinks = await this.page!.$$eval(
        'a[href*="/color/"]',
        links => [...new Set(links
          .map(a => ({
            url: (a as HTMLAnchorElement).href,
            name: a.textContent?.trim()
          }))
          .filter(l => l.url && l.name && l.url.includes('/color/'))
        )]
      );

      this.logger.info(`Found ${familyLinks.length} color families`);

      // Limit to main color families
      const mainFamilies = familyLinks.filter(f => 
        !f.url.includes('collection') && 
        !f.url.includes('inspiration')
      ).slice(0, 8);

      for (const family of mainFamilies) {
        try {
          await this.navigate(family.url);
          await this.page!.waitForSelector('[data-color], .color-swatch', { timeout: 10000 });

          // Scroll to load all colors
          await this.page!.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await this.page!.waitForTimeout(2000);

          const familyColors = await this.page!.$$eval(
            '[data-color], .color-swatch, [data-testid="color-card"]',
            (swatches, familyName) => {
              return swatches.map(swatch => {
                const el = swatch as HTMLElement;
                const name = el.querySelector('.color-name, [data-color-name]')?.textContent?.trim() || '';
                const code = el.getAttribute('data-color-code') || 
                            el.querySelector('.color-code')?.textContent?.trim() || '';
                const hex = el.getAttribute('data-color-hex') || 
                           el.style.backgroundColor || '';
                const collection = el.getAttribute('data-collection') || '';
                
                return { name, code, hex, collection, family: familyName };
              }).filter(c => c.name);
            },
            family.name
          );

          for (const colorData of familyColors) {
            const code = colorData.code || this.generateId('bm', colorData.name);
            const id = this.generateId(this.supplierId, code);
            
            const color: Color = {
              id,
              supplierId: this.supplierId,
              colorCode: code,
              name: colorData.name,
              hexCode: this.normalizeHex(colorData.hex),
              collection: colorData.collection || undefined,
              family: this.inferColorFamily(colorData.name),
              isPopular: false,
            };

            const validated = this.validateColor(color);
            if (validated) colors.push(validated);
          }

          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
          this.logger.warn(`Failed to scrape family ${family.name}:`, error);
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

  private inferColorFamily(colorName: string): string {
    const name = colorName.toLowerCase();
    
    if (name.includes('white') || name.includes('alabaster')) return 'whites';
    if (name.includes('gray') || name.includes('grey')) return 'grays';
    if (name.includes('beige') || name.includes('tan') || name.includes('greige')) return 'neutrals';
    if (name.includes('blue') || name.includes('navy')) return 'blues';
    if (name.includes('green') || name.includes('sage')) return 'greens';
    if (name.includes('red') || name.includes('burgundy') || name.includes('crimson')) return 'reds';
    if (name.includes('yellow') || name.includes('gold') || name.includes('ochre')) return 'yellows';
    if (name.includes('brown') || name.includes('chocolate') || name.includes('umber')) return 'browns';
    if (name.includes('black') || name.includes('charcoal')) return 'blacks';
    if (name.includes('purple') || name.includes('violet') || name.includes('plum')) return 'purples';
    if (name.includes('orange') || name.includes('peach') || name.includes('coral')) return 'oranges';
    
    return 'other';
  }

  async scrapeSundries(options?: ScrapeOptions): Promise<ScrapeResult<any>> {
    // Benjamin Moore sells some accessories but primarily through retailers
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }
}
