# Product-Color Relationships & Interior/Exterior Distinctions

## Overview

Colors are not inherently "interior" or "exterior" - they're just pigments. However, the **availability** and **recommendation** of colors varies by product and use case. This document explains how PaintFlow's scraper handles these relationships.

## Key Concepts

### 1. Colors vs. Products

**Colors** are the pigments (e.g., "Hale Navy", "Alabaster")
**Products** are the paint formulations (e.g., "Regal Select Interior", "Duration Exterior")

Most colors can be mixed into most products, but with constraints.

### 2. Base Requirements

Colors require specific **bases** depending on how dark they are:

| Color Darkness | Base Required | Example Colors |
|----------------|---------------|----------------|
| Very Light | Extra White | Whites, pastels |
| Light-Medium | Deep Base | Mid-tone colors |
| Dark | Ultra Deep | Navy, charcoal, black |

**Implication:** A product must be available in the required base to be tinted to that color.

### 3. Interior vs Exterior Recommendations

While the same color can be used inside or outside, suppliers make recommendations based on:

**Interior-specific colors:**
- More delicate, fashion-forward hues
- May fade faster in UV
- Often in designer collections

**Exterior-specific colors:**
- Fade-resistant pigments
- Often earth tones and classic colors
- Tested for UV stability

**Universal colors:**
- Work well both inside and out
- Most popular neutrals

### 4. Product Limitations

Not all products can be tinted to all colors:

| Product Type | Color Availability |
|--------------|-------------------|
| Premium interior | 3,500+ colors |
| Standard interior | 1,500+ colors |
| Exterior | 1,200+ colors (fade-resistant subset) |
| Primers | Limited to whites/grays |
| Specialty (metallics) | 50-100 colors |

## Database Schema

```sql
CREATE TABLE product_colors (
    product_id TEXT NOT NULL,
    color_id TEXT NOT NULL,
    is_available BOOLEAN DEFAULT 1,
    base_required TEXT, -- 'extra-white', 'deep-base', 'ultra-deep'
    recommended_use TEXT, -- JSON: ["interior", "exterior"]
    notes TEXT,
    PRIMARY KEY (product_id, color_id)
);
```

## Example Relationships

### Example 1: Universal Color

**Color:** Benjamin Moore "Hale Navy" (HC-154)

**Available in:**
- Regal Select Interior (base: ultra-deep, recommended: interior)
- Aura Interior (base: ultra-deep, recommended: interior)
- Regal Select Exterior (base: ultra-deep, recommended: exterior)
- Aura Exterior (base: ultra-deep, recommended: exterior)

**Notes:** Dark navy works anywhere, needs ultra-deep base

### Example 2: Interior-Focused Color

**Color:** Farrow & Ball "Pavilion Gray"

**Available in:**
- Estate Emulsion (base: deep, recommended: interior)
- Modern Emulsion (base: deep, recommended: interior)

**NOT available in:**
- Exterior Masonry (too delicate for UV)

### Example 3: Exterior Collection Color

**Color:** Sherwin-Williams "Rookwood Dark Red" (SW 2801)

**Available in:**
- Duration Exterior (base: deep, recommended: exterior)
- SuperPaint Exterior (base: deep, recommended: exterior)
- Emerald Interior (base: deep, recommended: interior)

**Notes:** Part of "Exterior Preservation Palette" but works inside too

## Scraping Strategy

### What We Scrape

1. **Product Pages** → Extract:
   - Available bases (extra white, deep, ultra deep)
   - Color system (e.g., "3,500 colors available")
   - Recommended use (interior/exterior/both)

2. **Color Pages** → Extract:
   - Color collections (e.g., "Exterior Colors", "Interior Design")
   - LRV (Light Reflectance Value)
   - Recommended applications

3. **Create Mappings** → Combine data to infer:
   - Which colors work with which products
   - Base requirements
   - Interior/exterior recommendations

### Implementation

```typescript
async scrapeProductColorMappings() {
  // For each product:
  // 1. Visit product page
  // 2. Extract available bases
  // 3. Extract color count or color system
  // 4. Extract recommended use
  
  // For each color:
  // 1. Check which collections it belongs to
  // 2. Check LRV (low LRV = needs deep base)
  // 3. Check if in "Exterior" collection
  
  // Create mappings with:
  // - isAvailable: true/false
  // - baseRequired: based on color darkness
  // - recommendedUse: based on collections
}
```

## Usage in PaintFlow

### For Estimators

When creating an estimate:

```typescript
// Customer wants "Hale Navy" for exterior
const products = await db.getProductsForColor('benjamin-moore:hale-navy-hc-154');

// Filter for exterior products
const exteriorProducts = products.filter(p => 
  p.recommended_use.includes('exterior')
);

// Show customer: "Available in Regal Select Exterior, Aura Exterior"
```

### For Color Selection

When customer picks a product:

```typescript
// Customer chose "Regal Select Interior"
const colors = await db.getColorsForProduct('benjamin-moore:regal-select-interior');

// Show color picker with 3,500 colors
// Filter by family, collection, etc.
```

### For Validation

Before finalizing estimate:

```typescript
// Check if color works with product
const mapping = await db.getProductColorMapping(productId, colorId);

if (!mapping.is_available) {
  throw new Error(`Color ${color.name} not available in ${product.name}`);
}

if (mapping.base_required && !product.bases.includes(mapping.base_required)) {
  throw new Error(`Product doesn't come in ${mapping.base_required} base`);
}
```

## Interior vs Exterior: Practical Guidance

### When a Customer Asks "Can I use this color outside?"

**Answer:** Usually yes, but check:

1. **Is the color very vibrant?** (bright reds, yellows)
   → May fade faster, recommend exterior-specific formulation

2. **Is the product exterior-rated?**
   → Most exterior products can be tinted to interior colors

3. **Is LRV very low?** (< 10)
   → Dark colors absorb heat, may cause issues on exterior

4. **Is it in an exterior collection?**
   → Supplier has tested it for UV stability

### Best Practice

For PaintFlow estimates:
- Default to "both" for most colors
- Flag colors with LRV < 15 as "interior recommended"
- Flag colors in "Exterior Collections" as "exterior tested"
- Always check product-color compatibility

## Current Implementation Status

✅ **Schema supports:** product-color relationships with base and use recommendations
✅ **Database client:** Methods to save and query mappings
✅ **Scraper stubs:** Methods exist but return empty (need actual page scraping)
⚠️ **Missing:** Actual scraping logic to populate mappings

### To Complete Implementation

The scrapers need to:

1. **Visit product pages** and extract:
   - Available bases
   - Color system/count
   - Recommended use

2. **Visit color pages** and extract:
   - Collections
   - Recommended applications
   - LRV

3. **Create mappings** based on:
   - Base requirements (from LRV)
   - Collection membership
   - Product capabilities

This requires more detailed scraping of individual product and color pages, which takes more time but provides accurate data.

## Example Queries

### Get all exterior-suitable colors for a product

```sql
SELECT c.*, pc.base_required
FROM colors c
JOIN product_colors pc ON c.id = pc.color_id
WHERE pc.product_id = 'sherwin-williams:duration-exterior'
  AND pc.is_available = 1
  AND json_extract(pc.recommended_use, '$') LIKE '%exterior%'
ORDER BY c.family, c.name;
```

### Find products that can be tinted to a specific color

```sql
SELECT p.*, pc.base_required, pc.recommended_use
FROM products p
JOIN product_colors pc ON p.id = pc.product_id
WHERE pc.color_id = 'benjamin-moore:hale-navy-hc-154'
  AND pc.is_available = 1
  AND p.is_active = 1;
```

### Count colors by recommended use

```sql
SELECT 
  json_extract(recommended_use, '$') as uses,
  COUNT(*) as color_count
FROM product_colors
WHERE product_id = 'sherwin-williams:superpaint-interior'
GROUP BY uses;
```

## Conclusion

Colors aren't inherently interior or exterior, but **product suitability** and **supplier recommendations** create practical distinctions. The scraper now supports tracking these relationships, but needs actual page scraping to populate the data accurately.

For PaintFlow's use case: Most customers will be fine with "this color works in this product", with base requirements being the real constraint.
