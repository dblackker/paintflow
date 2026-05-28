import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions, ProductColorMapping } from './base';

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
          const hasProductGrid = await this.waitForAnySelector('.product-card, .product-item, a[href*="/products/"]');
          if (!hasProductGrid) {
            failed++;
            continue;
          }

          // PPG uses a grid layout
          const productLinks = await this.page!.$$eval(
            '.product-card a, .product-item a, a[href*="/products/"]',
            links => {
              const seen = new Set<string>();
              return links.map(a => {
                const anchor = a as HTMLAnchorElement;
                return { url: anchor.href, label: anchor.textContent?.trim() || '' };
              }).filter((item) => {
                if (!item.url || seen.has(item.url)) return false;
                seen.add(item.url);
                return true;
              });
            }
          );

          this.logger.info(`Found ${productLinks.length} products`);

          for (const productLink of productLinks.slice(0, options?.limit)) {
            try {
              const product = process.env.SUPPLIER_DEEP_PRODUCT_DETAIL === 'true'
                ? await this.scrapeProductDetail(productLink.url, category.type)
                : this.productFromListing(productLink.url, productLink.label, category.type);
              if (product) {
                products.push(product);
                created++;
              }
            } catch (error) {
              errors.push(error as Error);
              failed++;
            }
            if (process.env.SUPPLIER_DEEP_PRODUCT_DETAIL === 'true') {
              await this.rateLimit();
            }
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

  private productFromListing(url: string, label: string, type: string): Product | null {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const name = label.replace(/\s+/g, ' ').trim() || this.nameFromSlug(slug);
    if (!name || name.length < 3) return null;
    const sku = slug || this.generateId('ppg', name);
    return this.validateProduct({
      id: this.generateId(this.supplierId, sku),
      supplierId: this.supplierId,
      sku,
      name,
      productLine: name.split(/\s+/).slice(0, 2).join(' '),
      type: this.normalizeProductType(type),
      category: 'paint',
      url,
    });
  }

  private nameFromSlug(slug: string) {
    return slug
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
      const hasColorPage = await this.waitForAnySelector('.color-swatch, .color-card, .color-family a, .palette-section a, a[href*="/color"]');
      if (!hasColorPage) {
        errors.push(new Error('PPG color selectors were not found'));
      }

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
          const hasSwatches = await this.waitForAnySelector('.color-swatch', 3000);
          if (!hasSwatches) continue;

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

  async scrapeProductColorMappings(options?: ScrapeOptions): Promise<ScrapeResult<ProductColorMapping>> {
    this.logScrapeStart('product-color mappings');
    const startTime = Date.now();
    const mappings: ProductColorMapping[] = [];
    const errors: Error[] = [];

    if (process.env.SUPPLIER_DEEP_PRODUCT_COLOR_MAPPING !== 'true') {
      this.logger.info('Skipping deep product-color mapping scrape; baseline compatibility mappings will be used when needed.');
      this.logScrapeComplete('product-color mappings', 0, Date.now() - startTime);
      return {
        success: true,
        data: mappings,
        errors,
        stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 },
      };
    }

    try {
      this.logger.info('Scraping product-color relationships for PPG');

      // Scrape key products
      const products = [];
      const productPaths = [
        { path: '/products/manor-hall-interior', type: 'interior' },
        { path: '/products/timeless-exterior', type: 'exterior' },
      ];

      for (const productInfo of productPaths) {
        try {
          await this.navigate(`${this.baseUrl}${productInfo.path}`);
          const hasProductTitle = await this.waitForAnySelector('h1, .product-title');
          if (!hasProductTitle) continue;

          const productData = await this.page!.$eval('body', () => {
            const name = document.querySelector('h1, .product-title')?.textContent?.trim() || '';
            const bases = Array.from(document.querySelectorAll('[data-base], .base'))
              .map(el => el.textContent?.trim())
              .filter(Boolean) as string[];
            return { name, bases };
          });

          if (productData.name) {
            const productId = this.generateId(this.supplierId, productData.name);
            products.push({
              id: productId,
              name: productData.name,
              type: productInfo.type,
              bases: productData.bases,
            });
          }
          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // Scrape colors
      await this.navigate(`${this.baseUrl}/color`);
      const hasSwatches = await this.waitForAnySelector('.color-swatch', 3000);
      if (!hasSwatches) {
        errors.push(new Error('PPG product-color mapping color swatches were not found'));
      }

      const colors = await this.page!.$$eval(
        '.color-swatch',
        swatches => swatches.slice(0, 30).map(swatch => {
          const name = swatch.querySelector('.color-name')?.textContent?.trim() || '';
          const code = swatch.querySelector('.color-code')?.textContent?.trim() || '';
          const hex = swatch.getAttribute('data-color') || '';
          
          let lrv = null;
          if (hex && hex.startsWith('#')) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            lrv = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 2.55);
          }
          
          return { name, code, hex, lrv };
        }).filter(c => c.name)
      );

      // Create mappings
      for (const product of products) {
        for (const color of colors) {
          let baseRequired = 'extra-white';
          if (color.lrv !== null) {
            if (color.lrv < 20) baseRequired = 'ultra-deep';
            else if (color.lrv < 50) baseRequired = 'deep-base';
          }

          const productId = product.id;
          const colorId = this.generateId(this.supplierId, color.code || color.name);

          mappings.push({
            productId,
            colorId,
            isAvailable: true,
            baseRequired,
            recommendedUse: [product.type],
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logScrapeComplete('product-color mappings', mappings.length, duration);

      return {
        success: true,
        data: mappings,
        errors,
        stats: {
          total: mappings.length,
          created: mappings.length,
          updated: 0,
          unchanged: 0,
          failed: errors.length
        }
      };
    } catch (error) {
      return {
        success: false,
        data: mappings,
        errors: [...errors, error as Error],
        stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 1 }
      };
    }
  }
}
