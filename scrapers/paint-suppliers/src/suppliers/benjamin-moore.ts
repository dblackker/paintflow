import { BaseSupplierScraper, Product, Pricing, Color, ScrapeResult, ScrapeOptions, ProductColorMapping } from './base';

export class BenjaminMooreScraper extends BaseSupplierScraper {
  supplierId = 'benjamin-moore';
  supplierName = 'Benjamin Moore';
  baseUrl = 'https://www.benjaminmoore.com';

  private productCatalogUrl = '/en-us/product-catalog';
  private colorCatalogUrl = '/en-us/paint-colors';

  async scrapeProducts(options?: ScrapeOptions): Promise<ScrapeResult<Product>> {
    this.logScrapeStart('products');
    const startTime = Date.now();
    const products: Product[] = [];
    const errors: Error[] = [];
    let created = 0, failed = 0;

    try {
      this.logger.info('Scraping product catalog...');

      try {
        await this.navigate(`${this.baseUrl}${this.productCatalogUrl}`);

        const hasProductLinks = await this.waitForAnySelector('a[href*="/en-us/product/"], a[href*="/product/"]');
        if (!hasProductLinks) {
          failed++;
        } else {
          await this.page!.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await this.page!.waitForTimeout(1000);

          const productLinks = await this.page!.$$eval('a[href*="/en-us/product/"], a[href*="/product/"]', links => {
            const scoreLabel = (label: string) => {
              const normalized = label.trim();
              if (!normalized) return 0;
              if (/^[A-Z]?\d{3,4}$/i.test(normalized)) return 1;
              if (/^\d+(\.\d+)?\s*out of/i.test(normalized)) return 1;
              if (/data sheets?|learn more|view product/i.test(normalized)) return 1;
              let score = normalized.length;
              if (/paint|stain|primer|sealer|enamel|coating|caulk/i.test(normalized)) score += 100;
              if (/[A-Z]\d{3}|^\d{3,4}\s+/i.test(normalized)) score += 20;
              return score;
            };

            const byUrl = new Map<string, { url: string; label: string; score: number }>();
            for (const link of links) {
              const anchor = link as HTMLAnchorElement;
              const url = anchor.href;
              const label = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
              if (!url || !/\/en-us\/product\//.test(url)) continue;
              const score = scoreLabel(label);
              const existing = byUrl.get(url);
              if (!existing || score > existing.score) byUrl.set(url, { url, label, score });
            }
            return Array.from(byUrl.values()).map(({ url, label }) => ({ url, label }));
          });

          this.logger.info(`Found ${productLinks.length} product links`);

          for (const productLink of productLinks.slice(0, options?.limit)) {
            try {
              const listingProduct = this.productFromListing(productLink.url, productLink.label);
              if (!listingProduct) continue;
              if (options?.types && !options.types.includes(listingProduct.type)) continue;

              const product = process.env.SUPPLIER_DEEP_PRODUCT_DETAIL === 'true'
                ? await this.scrapeProductDetail(productLink.url, listingProduct.type)
                : listingProduct;
              if (product) {
                products.push(product);
                created++;
              }
            } catch (error) {
              errors.push(error as Error);
              failed++;
              this.logger.warn(`Failed to scrape product ${productLink.url}:`, error);
            }
            if (process.env.SUPPLIER_DEEP_PRODUCT_DETAIL === 'true') {
              await this.rateLimit();
            }
          }
        }
      } catch (error) {
        errors.push(error as Error);
        this.logger.error('Failed to scrape product catalog:', error);
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

  private productFromListing(url: string, label: string): Product | null {
    const pathParts = new URL(url).pathname.split('/').filter(Boolean);
    const sku = pathParts[pathParts.length - 1] || this.generateId('bm', label);
    const slug = pathParts[pathParts.length - 2] || '';
    const name = this.cleanProductName(label, slug, sku);
    if (!name) return null;
    const type = this.productTypeFromName(name);
    return this.validateProduct({
      id: this.generateId(this.supplierId, sku),
      supplierId: this.supplierId,
      sku,
      name,
      productLine: this.productLineFromName(name),
      type,
      category: 'paint',
      sheens: this.parseSheens(name),
      url,
    });
  }

  private cleanProductName(label: string, slug: string, sku: string): string | null {
    const normalized = label.replace(/\s+/g, ' ').trim();
    const skuPattern = new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const badLabel = !normalized ||
      skuPattern.test(normalized) ||
      /^[A-Z]?\d{3,4}$/i.test(normalized) ||
      /^\d+(\.\d+)?\s*out of/i.test(normalized) ||
      /how can we help|data sheets?|learn more|view product/i.test(normalized);
    const name = badLabel ? this.nameFromSlug(slug) : normalized.replace(new RegExp(`^${sku}\\s+`, 'i'), '');
    if (!name || name.length < 3 || /how can we help/i.test(name)) return null;
    return name;
  }

  private productTypeFromName(name: string): Product['type'] {
    return this.normalizeProductType(name);
  }

  private productLineFromName(name: string): string {
    const withoutSku = name.replace(/^[A-Z]?\d{3,4}\s+/, '').trim();
    const match = withoutSku.match(/^(.+?)(?:\s+-|\s+Interior|\s+Exterior|\s+Paint|\s+Primer|\s+Stain|\s+Waterborne|\s+Alkyd|$)/i);
    return (match?.[1] || withoutSku.split(/\s+/).slice(0, 3).join(' ')).trim();
  }

  private parseSheens(name: string): string[] | undefined {
    const sheens = [
      'high gloss',
      'semi-gloss',
      'soft gloss',
      'low lustre',
      'eggshell',
      'satin',
      'pearl',
      'matte',
      'flat',
      'gloss',
    ];
    const found = sheens
      .filter((sheen) => new RegExp(`\\b${sheen.replace('-', '[-\\s]?')}\\b`, 'i').test(name))
      .map((sheen) => this.normalizeSheen(sheen));
    return found.length ? Array.from(new Set(found)) : undefined;
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
    
    // Wait for product details to load
    const hasProductDetail = await this.waitForAnySelector('h1, [data-testid="product-name"]');
    if (!hasProductDetail) return null;

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
      await this.navigate(`${this.baseUrl}${this.colorCatalogUrl}`);
      const hasColorLinks = await this.waitForAnySelector('a[href*="/paint-colors/color/"]');
      if (!hasColorLinks) {
        errors.push(new Error('Benjamin Moore paint color links were not found'));
      }

      const colorLinks = await this.page!.$$eval(
        'a[href*="/paint-colors/color/"]',
        links => {
          const byCode = new Map<string, { url: string; label: string; code: string; slug: string }>();
          for (const link of links) {
            const anchor = link as HTMLAnchorElement;
            const url = anchor.href;
            const match = url.match(/\/paint-colors\/color\/([^/]+)\/([^/?#]+)/i);
            if (!match) continue;
            const code = decodeURIComponent(match[1]);
            const slug = decodeURIComponent(match[2]);
            const label = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
            if (!byCode.has(code)) byCode.set(code, { url, label, code, slug });
          }
          return Array.from(byCode.values());
        }
      );

      this.logger.info(`Found ${colorLinks.length} color links`);

      const selectedColorLinks = colorLinks.slice(0, options?.limit);
      const detailsByUrl = await this.fetchColorDetails(selectedColorLinks.map((color) => color.url));

      for (const colorData of selectedColorLinks) {
        try {
          const name = this.cleanColorName(colorData.label, colorData.slug, colorData.code);
          const details = detailsByUrl.get(colorData.url);
          const id = this.generateId(this.supplierId, colorData.code);
          const color: Color = {
            id,
            supplierId: this.supplierId,
            colorCode: colorData.code,
            name,
            collection: details?.collection,
            family: details?.family || this.inferColorFamily(name),
            lrv: details?.lrv,
            isPopular: false,
          };

          const validated = this.validateColor(color);
          if (validated) colors.push(validated);
        } catch (error) {
          errors.push(error as Error);
          this.logger.warn(`Failed to parse color ${colorData.url}:`, error);
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

  private async fetchColorDetails(urls: string[]): Promise<Map<string, { collection?: string; family?: string; lrv?: number }>> {
    const details = new Map<string, { collection?: string; family?: string; lrv?: number }>();
    const concurrency = Math.max(1, Number(process.env.SUPPLIER_COLOR_DETAIL_CONCURRENCY || 2));
    let nextIndex = 0;
    let failed = 0;

    const worker = async () => {
      while (nextIndex < urls.length) {
        const url = urls[nextIndex++];
        try {
          const detail = await this.fetchColorDetail(url);
          if (detail) details.set(url, detail);
        } catch (error) {
          failed++;
          this.logger.warn(`Failed to enrich Benjamin Moore color ${url}:`, error);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

    this.logger.info(`Enriched ${details.size}/${urls.length} Benjamin Moore colors with detail metadata${failed ? ` (${failed} failed)` : ''}`);
    return details;
  }

  private async fetchColorDetail(url: string): Promise<{ collection?: string; family?: string; lrv?: number } | null> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const lrv = this.parseLrv(this.extractMetaContent(html, 'LRV Value'));
    const collection = this.extractMetaContent(html, 'Color Collection');
    const family = this.normalizeFamily(this.extractMetaContent(html, 'Primary Color Family'));
    return { collection, family, lrv };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const timeoutMs = Number(process.env.SUPPLIER_COLOR_DETAIL_TIMEOUT_MS || 10000);
    const maxAttempts = Math.max(1, Number(process.env.SUPPLIER_COLOR_DETAIL_RETRIES || 3));
    let lastResponse: Response | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'no-cache',
            'user-agent': this.getRandomUserAgent(),
          },
        });
        lastResponse = response;
        if (![403, 429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
          return response;
        }
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }

    throw new Error('No response received from supplier color detail page');
  }

  private extractMetaContent(html: string, name: string): string | undefined {
    const metas = html.match(/<meta\b[^>]*>/gi) || [];
    for (const meta of metas) {
      if (this.extractAttribute(meta, 'name')?.toLowerCase() !== name.toLowerCase()) continue;
      return this.decodeHtml(this.extractAttribute(meta, 'content') || '').trim() || undefined;
    }
    return undefined;
  }

  private extractAttribute(tag: string, attr: string): string | undefined {
    const match = tag.match(new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i'));
    return match?.[1];
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private parseLrv(value?: string): number | undefined {
    const parsed = value == null ? NaN : Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private normalizeFamily(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
    const map: Record<string, string> = {
      white: 'whites',
      gray: 'grays',
      grey: 'grays',
      neutral: 'neutrals',
      blue: 'blues',
      green: 'greens',
      red: 'reds',
      yellow: 'yellows',
      brown: 'browns',
      black: 'blacks',
      purple: 'purples',
      orange: 'oranges',
    };
    return map[normalized] || normalized;
  }

  private cleanColorName(label: string, slug: string, code: string): string {
    const normalized = label.replace(/\s+/g, ' ').trim();
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withoutCode = normalized
      .replace(new RegExp(`\\s*${escapedCode}\\s*$`, 'i'), '')
      .replace(new RegExp(`\\b${escapedCode}\\b`, 'i'), '')
      .trim();
    if (withoutCode && withoutCode.length > 2) return withoutCode;
    return this.nameFromSlug(slug);
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
      // Benjamin Moore strategy:
      // 1. Scrape product pages to get available bases
      // 2. Scrape colors to get LRV and collections
      // 3. Create mappings based on base requirements

      this.logger.info('Scraping product-color relationships for Benjamin Moore');

      // First, get products (we need their base info)
      // We'll scrape a few key products to demonstrate
      const productSlugs = [
        { name: 'Regal Select Interior', path: '/en-us/interior-paints-stains/regal-select', type: 'interior' },
        { name: 'Aura Interior', path: '/en-us/interior-paints-stains/aura', type: 'interior' },
        { name: 'Regal Select Exterior', path: '/en-us/exterior-paints-stains/regal-select', type: 'exterior' },
      ];

      const products = [];

      for (const productInfo of productSlugs.slice(0, options?.limit || 3)) {
        try {
          await this.navigate(`${this.baseUrl}${productInfo.path}`);
          const hasProductTitle = await this.waitForAnySelector('h1, [data-testid="product-name"]');
          if (!hasProductTitle) continue;

          const productData = await this.page!.$eval('body', () => {
            const name = document.querySelector('h1, [data-testid="product-name"]')?.textContent?.trim() || '';
            
            // Look for base information
            const baseElements = Array.from(document.querySelectorAll('[data-base], .base-option, [class*="base"]'));
            const bases = baseElements
              .map(el => el.textContent?.trim())
              .filter(Boolean)
              .filter(text => text && (text.toLowerCase().includes('base') || text.toLowerCase().includes('white')));
            
            // Look for color count or system info
            const colorInfo = document.querySelector('[class*="color"], [data-color-count]')?.textContent?.trim() || '';
            const hasColorSystem = colorInfo.toLowerCase().includes('color') || colorInfo.toLowerCase().includes('tint');
            
            // Extract product ID/sku
            const sku = document.querySelector('[data-sku], .sku')?.textContent?.trim() || name;
            
            return { name, sku, bases, hasColorSystem, colorInfo };
          });

          if (productData.name) {
            const productId = this.generateId(this.supplierId, productData.sku || productData.name);
            products.push({
              id: productId,
              name: productData.name,
              type: productInfo.type,
              bases: productData.bases,
              hasColorSystem: productData.hasColorSystem
            });

            this.logger.info(`Found product: ${productData.name}, bases: ${productData.bases.join(', ')}`);
          }

          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
          this.logger.warn(`Failed to scrape product ${productInfo.name}:`, error);
        }
      }

      // Now scrape colors to understand their characteristics
      // We'll get a sample of colors with different LRVs
      await this.navigate(`${this.baseUrl}/en-us/color-overview`);
      const hasColorLinks = await this.waitForAnySelector('[href*="/color/"], [data-color], .color-swatch');
      if (!hasColorLinks) {
        errors.push(new Error('Benjamin Moore product-color mapping color links were not found'));
      }

      // Get a color family page
      const colorFamilyLinks = await this.page!.$$eval(
        'a[href*="/color/"]',
        links => [...new Set(links
          .map(a => (a as HTMLAnchorElement).href)
          .filter(href => href.includes('/color/') && !href.includes('collection'))
        )].slice(0, 2)
      );

      const colors = [];

      for (const familyUrl of colorFamilyLinks) {
        try {
          await this.navigate(familyUrl);
          const hasSwatches = await this.waitForAnySelector('[data-color], .color-swatch', 3000);
          if (!hasSwatches) continue;

          // Extract colors with LRV info
          const familyColors = await this.page!.$$eval(
            '[data-color], .color-swatch, [data-testid="color-card"]',
            (swatches) => {
              return swatches.slice(0, 20).map(swatch => {
                const el = swatch as HTMLElement;
                const name = el.querySelector('.color-name, [data-color-name]')?.textContent?.trim() || '';
                const code = el.getAttribute('data-color-code') || 
                            el.querySelector('.color-code')?.textContent?.trim() || '';
                
                // Try to get LRV
                const lrvText = el.querySelector('[class*="lrv"], [data-lrv]')?.textContent?.trim() || '';
                const lrvMatch = lrvText.match(/(\d+\.?\d*)/);
                const lrv = lrvMatch ? parseFloat(lrvMatch[1]) : null;
                
                // Collections
                const collection = el.getAttribute('data-collection') || 
                                 el.closest('[data-collection]')?.getAttribute('data-collection') || '';
                
                return { name, code, lrv, collection };
              }).filter(c => c.name);
            }
          );

          colors.push(...familyColors);
          await this.rateLimit();
        } catch (error) {
          errors.push(error as Error);
        }
      }

      this.logger.info(`Scraped ${colors.length} colors for mapping`);

      // Create mappings: Product × Color
      // Determine base requirement from LRV
      // Determine recommended use from product type and color collection

      for (const product of products) {
        for (const color of colors) {
          // Determine base required based on LRV
          let baseRequired = 'extra-white';
          if (color.lrv !== null) {
            if (color.lrv < 20) baseRequired = 'ultra-deep';
            else if (color.lrv < 50) baseRequired = 'deep-base';
            else if (color.lrv < 75) baseRequired = 'medium-base';
            else baseRequired = 'extra-white';
          }

          // Check if product has this base
          const hasBase = product.bases.length === 0 || // Assume all bases if not specified
                         product.bases.some(b => 
                           b.toLowerCase().includes(baseRequired.replace('-', ' ')) ||
                           b.toLowerCase().includes('all') ||
                           b.toLowerCase().includes('tint')
                         );

          if (!hasBase && product.bases.length > 0) {
            continue; // Skip if product doesn't have required base
          }

          // Determine recommended use
          const recommendedUse = [];
          
          // Product type determines primary recommendation
          if (product.type === 'interior') recommendedUse.push('interior');
          if (product.type === 'exterior') recommendedUse.push('exterior');
          
          // Colors in exterior collections are good for exterior
          if (color.collection && color.collection.toLowerCase().includes('exterior')) {
            if (!recommendedUse.includes('exterior')) recommendedUse.push('exterior');
          }

          // Very dark colors (LRV < 10) may not be recommended for exterior due to heat
          if (color.lrv !== null && color.lrv < 10 && product.type === 'exterior') {
            // Still available but maybe not recommended
            // We'll keep it available but note it
          }

          // Most colors work for both if product is suitable
          if (recommendedUse.length === 0) {
            recommendedUse.push('interior', 'exterior');
          }

          const productId = product.id;
          const colorId = this.generateId(this.supplierId, color.code || color.name);

          mappings.push({
            productId,
            colorId,
            isAvailable: true,
            baseRequired,
            recommendedUse,
            notes: color.lrv !== null ? `LRV: ${color.lrv}` : undefined
          });
        }
      }

      this.logger.info(`Created ${mappings.length} product-color mappings`);

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
    // Benjamin Moore sells some accessories but primarily through retailers
    return {
      success: true,
      data: [],
      errors: [],
      stats: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
    };
  }
}
