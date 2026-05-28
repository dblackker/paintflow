import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions, ProductColorMapping } from './base';

export class PPGScraper extends BaseSupplierScraper {
  supplierId = 'ppg';
  supplierName = 'PPG Paints';
  baseUrl = 'https://www.ppgpaints.com';

  private productCategories = [
    { type: 'interior', url: '/products?category_equal=%5B%22interior-paint%22%5D' },
    { type: 'exterior', url: '/products?category_equal=%5B%22exterior-paint%22%5D' },
    { type: 'primer', url: '/products?category_equal=%5B%22primers%22%5D' },
  ];
  private colorFamilyPages = [
    { family: 'whites', url: '/ppg-color-families/off-whites' },
    { family: 'grays', url: '/ppg-color-families/grays-blacks' },
    { family: 'neutrals', url: '/ppg-color-families/beiges' },
    { family: 'neutrals', url: '/ppg-color-families/neutrals' },
    { family: 'metallics', url: '/ppg-color-families/metallics' },
    { family: 'blues', url: '/ppg-color-families/blues' },
    { family: 'aquas', url: '/ppg-color-families/aquas' },
    { family: 'greens', url: '/ppg-color-families/greens' },
    { family: 'yellows', url: '/ppg-color-families/yellows' },
    { family: 'oranges', url: '/ppg-color-families/oranges' },
    { family: 'reds', url: '/ppg-color-families/reds' },
    { family: 'purples', url: '/ppg-color-families/purples' },
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
          const hasProductGrid = await this.waitForAnySelector('.product-card_container, .product-card, .product-item, a[href*="/ppg-products/"]');
          if (!hasProductGrid) {
            failed++;
            continue;
          }

          const productLinks = await this.page!.$$eval(
            '.product-card_container, .product-card, .product-item, a[href*="/ppg-products/"]',
            elements => {
              const seen = new Set<string>();
              return elements.map((element) => {
                const anchor = element.matches('a')
                  ? element as HTMLAnchorElement
                  : element.querySelector('a[href*="/ppg-products/"]') as HTMLAnchorElement | null;
                const title = element.querySelector('.product-card_title, h2, h3')?.textContent?.trim() || '';
                const sku = Array.from(element.querySelectorAll('div, span, p'))
                  .map((child) => child.textContent?.trim() || '')
                  .find((text) => /[A-Z0-9-]+\/\d{2}/.test(text)) || '';
                return {
                  url: anchor?.href || '',
                  label: title || anchor?.textContent?.trim() || '',
                  sku,
                };
              }).filter((item) => {
                if (!item.url || !item.url.includes('/ppg-products/') || seen.has(item.url)) return false;
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
                : this.productFromListing(productLink.url, productLink.label, category.type, productLink.sku);
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

  private productFromListing(url: string, label: string, type: string, skuText?: string): Product | null {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const name = label.replace(/\s+/g, ' ').trim() || this.nameFromSlug(slug);
    if (!name || name.length < 3 || /^\d+(\.\d+)?$/.test(name)) return null;
    const sku = skuText?.split(',')[0]?.trim() || slug || this.generateId('ppg', name);
    return this.validateProduct({
      id: this.generateId(this.supplierId, sku),
      supplierId: this.supplierId,
      sku,
      name,
      productLine: this.productLineFromName(name),
      type: this.normalizeProductType(type),
      category: 'paint',
      url,
    });
  }

  private productLineFromName(name: string): string {
    const cleaned = name.replace(/[^\x00-\x7F]/g, '').trim();
    const match = cleaned.match(/^(.+?)(?:\s+Interior|\s+Exterior|\s+Latex|\s+Paint|\s+Primer|\s+Stain|$)/i);
    return (match?.[1] || cleaned.split(/\s+/).slice(0, 3).join(' ')).trim();
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
      const byCode = new Map<string, Color>();

      for (const familyPage of this.colorFamilyPages) {
        try {
          await this.navigate(`${this.baseUrl}${familyPage.url}`);
          const hasColorPage = await this.waitForAnySelector('a[href*="/ppg-colors/"]');
          if (!hasColorPage) {
            errors.push(new Error(`PPG color links were not found on ${familyPage.url}`));
            continue;
          }

          const colorLinks = await this.page!.$$eval(
            'a[href*="/ppg-colors/"]',
            links => {
              const byUrl = new Map<string, { url: string; label: string }>();
              for (const link of links) {
                const anchor = link as HTMLAnchorElement;
                const url = anchor.href.split('?')[0].split('#')[0];
                const label = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
                if (!url.includes('/ppg-colors/') || !label) continue;
                const existing = byUrl.get(url);
                if (!existing || label.length > existing.label.length) byUrl.set(url, { url, label });
              }
              return Array.from(byUrl.values());
            }
          );

          this.logger.info(`Found ${colorLinks.length} ${familyPage.family} color links`);

          const detailsByUrl = await this.fetchColorDetails(colorLinks.map((color) => color.url));

          for (const colorLink of colorLinks) {
            const parsed = this.colorFromLink(colorLink.url, colorLink.label, familyPage.family, detailsByUrl.get(colorLink.url));
            if (!parsed) continue;
            byCode.set(parsed.colorCode.toLowerCase(), parsed);
            if (options?.limit && byCode.size >= options.limit) break;
          }
          if (options?.limit && byCode.size >= options.limit) break;
        } catch (error) {
          errors.push(error as Error);
          this.logger.warn(`Failed to scrape PPG color family ${familyPage.url}:`, error);
        }
      }

      for (const color of byCode.values()) {
        const validated = this.validateColor(color);
        if (validated) colors.push(validated);
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

  private async fetchColorDetails(urls: string[]): Promise<Map<string, { rgbR?: number; rgbG?: number; rgbB?: number; hexCode?: string; lrv?: number }>> {
    const details = new Map<string, { rgbR?: number; rgbG?: number; rgbB?: number; hexCode?: string; lrv?: number }>();
    const concurrency = Math.max(1, Number(process.env.SUPPLIER_COLOR_DETAIL_CONCURRENCY || 8));
    let nextIndex = 0;
    let failed = 0;

    const worker = async () => {
      while (nextIndex < urls.length) {
        const url = urls[nextIndex++];
        if (details.has(url)) continue;
        try {
          const detail = await this.fetchColorDetail(url);
          if (detail) details.set(url, detail);
        } catch (error) {
          failed++;
          this.logger.warn(`Failed to enrich PPG color ${url}:`, error);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

    this.logger.info(`Enriched ${details.size}/${urls.length} PPG colors with detail metadata${failed ? ` (${failed} failed)` : ''}`);
    return details;
  }

  private async fetchColorDetail(url: string): Promise<{ rgbR?: number; rgbG?: number; rgbB?: number; hexCode?: string; lrv?: number } | null> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const match = text.match(/\bR:\s*(\d{1,3})\s*G:\s*(\d{1,3})\s*B:\s*(\d{1,3})\s*LRV:\s*(\d{1,3})\b/i);
    if (!match) return null;

    const rgbR = this.parseByte(match[1]);
    const rgbG = this.parseByte(match[2]);
    const rgbB = this.parseByte(match[3]);
    const lrv = this.parseLrv(match[4]);
    if (rgbR == null || rgbG == null || rgbB == null) return { lrv };

    return {
      rgbR,
      rgbG,
      rgbB,
      hexCode: this.rgbToHex(rgbR, rgbG, rgbB),
      lrv,
    };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.SUPPLIER_COLOR_DETAIL_TIMEOUT_MS || 10000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': this.getRandomUserAgent(),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseByte(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) return undefined;
    return parsed;
  }

  private parseLrv(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return undefined;
    return parsed;
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  private colorFromLink(
    url: string,
    label: string,
    family?: string,
    details?: { rgbR?: number; rgbG?: number; rgbB?: number; hexCode?: string; lrv?: number }
  ): Color | null {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const codeMatch = label.match(/([A-Z]{2,5}\d{2,4}|PPG\d{4}-\d|MTL\d{3})$/i);
    const colorCode = codeMatch?.[1] || slug.toUpperCase();
    const name = (codeMatch ? label.slice(0, codeMatch.index).trim() : label.trim()) || this.nameFromSlug(slug);
    if (!name || name.length < 2) return null;
    return {
      id: this.generateId(this.supplierId, colorCode),
      supplierId: this.supplierId,
      colorCode,
      name,
      hexCode: details?.hexCode,
      rgbR: details?.rgbR,
      rgbG: details?.rgbG,
      rgbB: details?.rgbB,
      family: family || this.inferColorFamily(name),
      lrv: details?.lrv,
      isPopular: false,
    };
  }

  private inferColorFamily(colorName: string): string {
    const name = colorName.toLowerCase();
    if (name.includes('white') || name.includes('ivory')) return 'whites';
    if (name.includes('gray') || name.includes('grey') || name.includes('black') || name.includes('flint')) return 'grays';
    if (name.includes('beige') || name.includes('neutral') || name.includes('tan')) return 'neutrals';
    if (name.includes('blue')) return 'blues';
    if (name.includes('aqua') || name.includes('teal')) return 'aquas';
    if (name.includes('green') || name.includes('foliage') || name.includes('topiary')) return 'greens';
    if (name.includes('red') || name.includes('mahogany')) return 'reds';
    if (name.includes('yellow') || name.includes('gold')) return 'yellows';
    if (name.includes('orange') || name.includes('copper') || name.includes('ginger')) return 'oranges';
    if (name.includes('purple') || name.includes('orchid')) return 'purples';
    if (name.includes('brown') || name.includes('caramel') || name.includes('chestnut')) return 'browns';
    return 'other';
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
