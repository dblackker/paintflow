import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions, ProductColorMapping } from './base';

export class SherwinWilliamsScraper extends BaseSupplierScraper {
  supplierId = 'sherwin-williams';
  supplierName = 'Sherwin-Williams';
  baseUrl = 'https://www.sherwin-williams.com';
  
  // Product categories to scrape
  private productCategories = [
    { type: 'interior', url: '/homeowners/products/interior-paint-coatings' },
    { type: 'exterior', url: '/homeowners/products/exterior-paint-coatings' },
    { type: 'primer', url: '/homeowners/products/primers' },
    { type: 'specialty', url: '/homeowners/products/specialty-paint-coatings' },
  ];

  async scrapeProducts(options?: ScrapeOptions): Promise<ScrapeResult<Product>> {
    this.logScrapeStart('products');
    const startTime = Date.now();
    const products: Product[] = [];
    const errors: Error[] = [];
    let created = 0, updated = 0, unchanged = 0, failed = 0;

    try {
      for (const category of this.productCategories) {
        if (options?.types && !options.types.includes(category.type)) {
          continue;
        }

        this.logger.info(`Scraping ${category.type} products...`);
        
        try {
          await this.navigate(`${this.baseUrl}${category.url}`);
          
          // Wait for product grid to load
          await this.page!.waitForSelector('[data-testid="product-card"], .product-tile', { timeout: 10000 });
          
          // Get all product links
          const productLinks = await this.page!.$$eval(
            '[data-testid="product-card"] a, .product-tile a',
            links => links.map(a => (a as HTMLAnchorElement).href).filter(Boolean)
          );

          this.logger.info(`Found ${productLinks.length} products in ${category.type}`);

          // Scrape each product
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
              this.logger.warn(`Failed to scrape product ${link}:`, error);
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
        stats: {
          total: products.length,
          created,
          updated,
          unchanged,
          failed,
        }
      };
    } catch (error) {
      return {
        success: false,
        data: products,
        errors: [...errors, error as Error],
        stats: { total: products.length, created, updated, unchanged, failed: failed + 1 }
      };
    }
  }

  private async scrapeProductDetail(url: string, type: string): Promise<Product | null> {
    await this.navigate(url);
    
    // Extract product details
    const productData = await this.page!.$eval('body', (body) => {
      // This would be customized based on actual SW site structure
      const name = document.querySelector('h1.product-name, [data-testid="product-title"]')?.textContent?.trim() || '';
      const sku = document.querySelector('[data-testid="product-sku"], .sku')?.textContent?.trim() || '';
      const description = document.querySelector('.product-description, [data-testid="product-description"]')?.textContent?.trim() || '';
      const features = Array.from(document.querySelectorAll('.feature-list li, [data-testid="feature-item"]'))
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];
      
      // Extract sheens
      const sheenElements = document.querySelectorAll('.sheen-option, [data-testid="sheen"]');
      const sheens = Array.from(sheenElements)
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];
      
      // Extract product line from breadcrumbs or title
      const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a'))
        .map(el => el.textContent?.trim())
        .filter(Boolean);
      const productLine = breadcrumbs.length > 1 ? breadcrumbs[1] : '';
      
      return {
        name,
        sku,
        description,
        features,
        sheens,
        productLine,
      };
    });

    if (!productData.name || !productData.sku) {
      return null;
    }

    const id = this.generateId(this.supplierId, productData.sku);
    
    const product: Product = {
      id,
      supplierId: this.supplierId,
      sku: productData.sku,
      name: productData.name,
      productLine: productData.productLine,
      type: this.normalizeProductType(type),
      description: productData.description,
      features: productData.features,
      sheens: productData.sheens.map(s => this.normalizeSheen(s)),
      url,
    };

    return this.validateProduct(product);
  }

  async scrapePricing(options?: ScrapeOptions): Promise<ScrapeResult<Pricing>> {
    this.logScrapeStart('pricing');
    const startTime = Date.now();
    const pricing: Pricing[] = [];
    const errors: Error[] = [];

    // Sherwin-Williams pricing is often behind login or varies by store
    // This would need to handle authentication or use public pricing
    // For now, return empty with note
    
    this.logger.warn('Sherwin-Williams pricing requires authentication - implement store-specific scraping');
    
    const duration = Date.now() - startTime;
    this.logScrapeComplete('pricing', 0, duration);

    return {
      success: true,
      data: pricing,
      errors,
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }

  async scrapeColors(options?: ScrapeOptions): Promise<ScrapeResult<Color>> {
    this.logScrapeStart('colors');
    const startTime = Date.now();
    const colors: Color[] = [];
    const errors: Error[] = [];
    let created = 0;

    try {
      // Navigate to color collections
      await this.navigate(`${this.baseUrl}/homeowners/color`);
      await this.page!.waitForSelector('.color-collection, [data-testid="color-swatch"]', { timeout: 10000 });

      // Get color collection links
      const collectionLinks = await this.page!.$$eval(
        '.color-collection a, [data-testid="collection-link"]',
        links => links.map(a => ({
          url: (a as HTMLAnchorElement).href,
          name: a.textContent?.trim()
        })).filter(l => l.url)
      );

      this.logger.info(`Found ${collectionLinks.length} color collections`);

      for (const collection of collectionLinks.slice(0, 10)) { // Limit for demo
        try {
          await this.navigate(collection.url);
          await this.page!.waitForSelector('.color-swatch, [data-testid="color-card"]', { timeout: 5000 });

          const collectionColors = await this.page!.$$eval(
            '.color-swatch, [data-testid="color-card"]',
            (swatches, collectionName) => {
              return swatches.map(swatch => {
                const name = swatch.querySelector('.color-name, [data-testid="color-name"]')?.textContent?.trim() || '';
                const code = swatch.querySelector('.color-code, [data-testid="color-code"]')?.textContent?.trim() || '';
                const hex = swatch.getAttribute('data-hex') || 
                           (swatch as HTMLElement).style.backgroundColor || '';
                
                return { name, code, hex, collection: collectionName };
              }).filter(c => c.name && c.code);
            },
            collection.name
          );

          for (const colorData of collectionColors) {
            const id = this.generateId(this.supplierId, colorData.code);
            
            // Parse hex from rgb if needed
            let hexCode = colorData.hex;
            if (hexCode?.startsWith('rgb')) {
              const match = hexCode.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
              if (match) {
                const r = parseInt(match[1]).toString(16).padStart(2, '0');
                const g = parseInt(match[2]).toString(16).padStart(2, '0');
                const b = parseInt(match[3]).toString(16).padStart(2, '0');
                hexCode = `#${r}${g}${b}`;
              }
            }

            const color: Color = {
              id,
              supplierId: this.supplierId,
              colorCode: colorData.code,
              name: colorData.name,
              hexCode: hexCode?.startsWith('#') ? hexCode : undefined,
              collection: colorData.collection,
              family: this.inferColorFamily(colorData.name),
              isPopular: false, // Would need additional data
            };

            const validated = this.validateColor(color);
            if (validated) {
              colors.push(validated);
              created++;
            }
          }

          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
          this.logger.warn(`Failed to scrape collection ${collection.name}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      this.logScrapeComplete('colors', colors.length, duration);

      return {
        success: errors.length === 0,
        data: colors,
        errors,
        stats: {
          total: colors.length,
          created,
          updated: 0,
          unchanged: 0,
          failed: errors.length
        }
      };
    } catch (error) {
      return {
        success: false,
        data: colors,
        errors: [...errors, error as Error],
        stats: { total: colors.length, created, updated: 0, unchanged: 0, failed: errors.length + 1 }
      };
    }
  }

  private inferColorFamily(colorName: string): string {
    const name = colorName.toLowerCase();
    
    if (name.includes('white') || name.includes('alabaster') || name.includes('snow')) return 'whites';
    if (name.includes('gray') || name.includes('grey')) return 'grays';
    if (name.includes('beige') || name.includes('tan') || name.includes('greige')) return 'neutrals';
    if (name.includes('blue')) return 'blues';
    if (name.includes('green')) return 'greens';
    if (name.includes('red') || name.includes('burgundy')) return 'reds';
    if (name.includes('yellow') || name.includes('gold')) return 'yellows';
    if (name.includes('brown') || name.includes('chocolate')) return 'browns';
    if (name.includes('black')) return 'blacks';
    
    return 'other';
  }

  async scrapeProductColorMappings(options?: ScrapeOptions): Promise<ScrapeResult<ProductColorMapping>> {
    this.logScrapeStart('product-color mappings');
    const startTime = Date.now();
    const mappings: ProductColorMapping[] = [];
    const errors: Error[] = [];

    try {
      this.logger.info('Scraping product-color relationships for Sherwin-Williams');

      // Scrape key products
      const productPaths = [
        { name: 'SuperPaint Interior', path: '/homeowners/products/superpaint-interior', type: 'interior' },
        { name: 'Duration Exterior', path: '/homeowners/products/duration-exterior', type: 'exterior' },
        { name: 'Emerald Interior', path: '/homeowners/products/emerald-interior', type: 'interior' },
      ];

      const products = [];

      for (const productInfo of productPaths.slice(0, options?.limit || 3)) {
        try {
          await this.navigate(`${this.baseUrl}${productInfo.path}`);
          await this.page!.waitForSelector('h1, [data-testid="product-title"]', { timeout: 10000 });

          const productData = await this.page!.$eval('body', () => {
            const name = document.querySelector('h1, [data-testid="product-title"]')?.textContent?.trim() || '';
            const sku = document.querySelector('[data-testid="product-sku"], .sku')?.textContent?.trim() || '';
            
            // Extract bases
            const baseElements = document.querySelectorAll('.base-option, [data-base], [class*="base"]');
            const bases = Array.from(baseElements)
              .map(el => el.textContent?.trim())
              .filter(Boolean)
              .filter(text => text && text.toLowerCase().includes('base')) as string[];
            
            // Check for color information
            const colorInfo = document.body.textContent || '';
            const hasColorSystem = colorInfo.toLowerCase().includes('color') && 
                                  (colorInfo.toLowerCase().includes('tint') || 
                                   colorInfo.toLowerCase().includes('thousand'));
            
            return { name, sku, bases, hasColorSystem };
          });

          if (productData.name) {
            const productId = this.generateId(this.supplierId, productData.sku || productData.name);
            products.push({
              id: productId,
              name: productData.name,
              type: productInfo.type,
              bases: productData.bases,
            });
            this.logger.info(`Product: ${productData.name}, bases: ${productData.bases.length}`);
          }

          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // Scrape colors - get from color collections
      await this.navigate(`${this.baseUrl}/homeowners/color`);
      await this.page!.waitForSelector('.color-collection', { timeout: 10000 });

      const colors = [];
      const collectionLinks = await this.page!.$$eval(
        '.color-collection a',
        links => links.slice(0, 2).map(a => (a as HTMLAnchorElement).href)
      );

      for (const link of collectionLinks) {
        try {
          await this.navigate(link);
          await this.page!.waitForSelector('.color-swatch', { timeout: 5000 });

          const collectionColors = await this.page!.$$eval(
            '.color-swatch',
            swatches => swatches.slice(0, 30).map(swatch => {
              const name = swatch.querySelector('.color-name')?.textContent?.trim() || '';
              const code = swatch.querySelector('.color-code')?.textContent?.trim() || '';
              const hex = swatch.getAttribute('data-hex') || '';
              
              // Estimate LRV from hex (rough approximation)
              let lrv = null;
              if (hex && hex.startsWith('#')) {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                // Simple luminance formula
                lrv = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 2.55);
              }
              
              return { name, code, hex, lrv };
            }).filter(c => c.name)
          );

          colors.push(...collectionColors);
          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
        }
      }

      this.logger.info(`Scraped ${colors.length} colors`);

      // Create mappings
      for (const product of products) {
        for (const color of colors) {
          // Determine base required from LRV
          let baseRequired = 'extra-white';
          if (color.lrv !== null) {
            if (color.lrv < 20) baseRequired = 'ultra-deep';
            else if (color.lrv < 50) baseRequired = 'deep-base';
            else baseRequired = 'extra-white';
          }

          // Recommended use based on product type
          const recommendedUse = [product.type];
          
          // Most SW colors work for both if product is suitable
          // Add both if it's a popular neutral
          if (color.lrv !== null && color.lrv > 50 && color.lrv < 85) {
            if (!recommendedUse.includes('interior')) recommendedUse.push('interior');
            if (!recommendedUse.includes('exterior')) recommendedUse.push('exterior');
          }

          const productId = product.id;
          const colorId = this.generateId(this.supplierId, color.code || color.name);

          mappings.push({
            productId,
            colorId,
            isAvailable: true,
            baseRequired,
            recommendedUse,
          });
        }
      }

      this.logger.info(`Created ${mappings.length} mappings`);

      const duration = Date.now() - startTime;
      this.logScrapeComplete('product-color mappings', mappings.length, duration);

      return {
        success: errors.length === 0,
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

  async scrapeSundries(options?: ScrapeOptions): Promise<ScrapeResult<any>> {
    // SW sells brushes, rollers, tape, etc.
    // Implementation similar to products
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }
}
