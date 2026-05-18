export const PAINT_CATALOG = {
  'sherwin-williams': {
    name: 'Sherwin-Williams',
    lines: {
      'emerald': {
        name: 'Emerald',
        tier: 'premium',
        interior: {
          flat: { price: 94.99, coverage: 350 },
          matte: { price: 94.99, coverage: 350 },
          satin: { price: 94.99, coverage: 350 },
          semiGloss: { price: 94.99, coverage: 350 },
        },
        exterior: {
          flat: { price: 99.99, coverage: 400 },
          satin: { price: 99.99, coverage: 400 },
        }
      },
      'duration': {
        name: 'Duration Home',
        tier: 'premium',
        interior: {
          matte: { price: 84.99, coverage: 350 },
          satin: { price: 84.99, coverage: 350 },
          semiGloss: { price: 84.99, coverage: 350 },
        },
        exterior: {
          flat: { price: 89.99, coverage: 400 },
          satin: { price: 89.99, coverage: 400 },
        }
      },
      'superpaint': {
        name: 'SuperPaint',
        tier: 'professional',
        interior: {
          flat: { price: 64.99, coverage: 350 },
          eggshell: { price: 64.99, coverage: 350 },
          satin: { price: 64.99, coverage: 350 },
          semiGloss: { price: 64.99, coverage: 350 },
        },
        exterior: {
          flat: { price: 69.99, coverage: 400 },
          satin: { price: 69.99, coverage: 400 },
        }
      },
      'promar-200': {
        name: 'ProMar 200',
        tier: 'contractor',
        interior: {
          flat: { price: 39.99, coverage: 400 },
          eggshell: { price: 39.99, coverage: 400 },
          semiGloss: { price: 39.99, coverage: 400 },
        }
      },
      'cashmere': {
        name: 'Cashmere',
        tier: 'premium',
        interior: {
          flat: { price: 74.99, coverage: 350 },
          lowLustre: { price: 74.99, coverage: 350 },
          mediumLustre: { price: 74.99, coverage: 350 },
        }
      }
    },
    primers: {
      'premium-wall-primer': { price: 29.99, coverage: 300 },
      'multi-purpose-primer': { price: 24.99, coverage: 300 },
      'extreme-bond': { price: 44.99, coverage: 350 },
    }
  },
  'benjamin-moore': {
    name: 'Benjamin Moore',
    lines: {
      'aura': {
        name: 'Aura',
        tier: 'premium',
        interior: {
          matte: { price: 89.99, coverage: 400 },
          eggshell: { price: 89.99, coverage: 400 },
          satin: { price: 89.99, coverage: 400 },
          semiGloss: { price: 89.99, coverage: 400 },
        },
        exterior: {
          flat: { price: 94.99, coverage: 400 },
          softGloss: { price: 94.99, coverage: 400 },
        }
      },
      'regal-select': {
        name: 'Regal Select',
        tier: 'premium',
        interior: {
          flat: { price: 69.99, coverage: 400 },
          matte: { price: 69.99, coverage: 400 },
          eggshell: { price: 69.99, coverage: 400 },
          pearl: { price: 69.99, coverage: 400 },
          semiGloss: { price: 69.99, coverage: 400 },
        },
        exterior: {
          flat: { price: 74.99, coverage: 400 },
          lowLustre: { price: 74.99, coverage: 400 },
          softGloss: { price: 74.99, coverage: 400 },
        }
      },
      'ben': {
        name: 'ben',
        tier: 'contractor',
        interior: {
          flat: { price: 49.99, coverage: 400 },
          eggshell: { price: 49.99, coverage: 400 },
          semiGloss: { price: 49.99, coverage: 400 },
        }
      },
      'advance': {
        name: 'Advance',
        tier: 'premium',
        interior: {
          matte: { price: 79.99, coverage: 400 },
          satin: { price: 79.99, coverage: 400 },
          semiGloss: { price: 79.99, coverage: 400 },
          highGloss: { price: 79.99, coverage: 400 },
        }
      }
    },
    primers: {
      'fresh-start': { price: 34.99, coverage: 350 },
      'stix': { price: 49.99, coverage: 350 },
    }
  },
  'behr': {
    name: 'Behr',
    lines: {
      'marquee': {
        name: 'Marquee',
        tier: 'premium',
        interior: {
          flat: { price: 54.99, coverage: 400 },
          eggshell: { price: 54.99, coverage: 400 },
          satin: { price: 54.99, coverage: 400 },
          semiGloss: { price: 54.99, coverage: 400 },
        },
        exterior: {
          flat: { price: 59.99, coverage: 400 },
          satin: { price: 59.99, coverage: 400 },
        }
      },
      'ultra': {
        name: 'Ultra',
        tier: 'professional',
        interior: {
          flat: { price: 44.99, coverage: 400 },
          eggshell: { price: 44.99, coverage: 400 },
          satin: { price: 44.99, coverage: 400 },
          semiGloss: { price: 44.99, coverage: 400 },
        }
      },
      'premium-plus': {
        name: 'Premium Plus',
        tier: 'contractor',
        interior: {
          flat: { price: 34.99, coverage: 400 },
          eggshell: { price: 34.99, coverage: 400 },
          satin: { price: 34.99, coverage: 400 },
        }
      }
    },
    primers: {
      'multi-surface': { price: 19.99, coverage: 300 },
    }
  },
  'ppg': {
    name: 'PPG',
    lines: {
      'timeless': {
        name: 'Timeless',
        tier: 'premium',
        interior: {
          flat: { price: 64.99, coverage: 400 },
          eggshell: { price: 64.99, coverage: 400 },
          satin: { price: 64.99, coverage: 400 },
          semiGloss: { price: 64.99, coverage: 400 },
        }
      },
      'manor-hall': {
        name: 'Manor Hall',
        tier: 'professional',
        interior: {
          flat: { price: 54.99, coverage: 400 },
          eggshell: { price: 54.99, coverage: 400 },
          satin: { price: 54.99, coverage: 400 },
        }
      }
    }
  }
};

export const SUPPLIES = [
  { name: 'Painter\'s Tape 1.5"', category: 'supplies', brand: '3M', unit: 'roll', cost: 7.99 },
  { name: 'Drop Cloths 9x12', category: 'supplies', brand: 'Trimaco', unit: 'each', cost: 14.99 },
  { name: 'Roller Covers 3/8"', category: 'supplies', brand: 'Wooster', unit: 'each', cost: 4.99 },
  { name: 'Roller Covers 1/2"', category: 'supplies', brand: 'Wooster', unit: 'each', cost: 5.49 },
  { name: 'Roller Frame 9"', category: 'supplies', brand: 'Wooster', unit: 'each', cost: 12.99 },
  { name: 'Angled Brush 2"', category: 'supplies', brand: 'Purdy', unit: 'each', cost: 19.99 },
  { name: 'Angled Brush 2.5"', category: 'supplies', brand: 'Purdy', unit: 'each', cost: 24.99 },
  { name: '5-in-1 Tool', category: 'supplies', brand: 'Hyde', unit: 'each', cost: 9.99 },
  { name: 'Sandpaper 120 grit', category: 'supplies', unit: 'sheet', cost: 0.99 },
  { name: 'Caulk - Paintable', category: 'supplies', brand: 'DAP', unit: 'tube', cost: 4.99 },
  { name: 'Spackle', category: 'supplies', brand: '3M', unit: 'tub', cost: 8.99 },
];

// API sync framework (for future implementation)
export const MATERIAL_API_PROVIDERS = {
  // Note: These are aspirational - most paint companies don't offer public APIs
  // Would need to scrape or use distributor APIs like Sherwin-Williams PRO+ portal
  'sherwin-williams': {
    enabled: false,
    endpoint: null,
    note: 'No public API. Prices from PRO+ portal or retail site scraping.',
    updateFrequency: 'monthly',
  },
  'benjamin-moore': {
    enabled: false,
    endpoint: null,
    note: 'No public API. Manual updates required.',
    updateFrequency: 'quarterly',
  },
  'behr': {
    enabled: false,
    endpoint: null,
    note: 'Home Depot pricing varies by region. No API.',
    updateFrequency: 'quarterly',
  },
};

export function flattenCatalog() {
  const materials = [];
  
  for (const [brandKey, brand] of Object.entries(PAINT_CATALOG)) {
    for (const [lineKey, line] of Object.entries(brand.lines)) {
      for (const [location, sheens] of Object.entries(line)) {
        if (location === 'name' || location === 'tier') continue;
        for (const [sheen, data] of Object.entries(sheens)) {
          materials.push({
            name: `${brand.name} ${line.name} ${sheen}`,
            brand: brand.name,
            category: 'paint',
            line: line.name,
            tier: line.tier,
            location,
            sheen,
            unit: 'gallon',
            costPerUnit: data.price,
            coverageSqFt: data.coverage,
            sku: `${brandKey}-${lineKey}-${location}-${sheen}`.toUpperCase(),
          });
        }
      }
    }
    
    if (brand.primers) {
      for (const [primerKey, primer] of Object.entries(brand.primers)) {
        materials.push({
          name: `${brand.name} ${primerKey.replace(/-/g, ' ')}`,
          brand: brand.name,
          category: 'primer',
          unit: 'gallon',
          costPerUnit: primer.price,
          coverageSqFt: primer.coverage,
          sku: `${brandKey}-${primerKey}`.toUpperCase(),
        });
      }
    }
  }
  
  for (const supply of SUPPLIES) {
    materials.push({
      ...supply,
      markupPercent: 50,
    });
  }
  
  return materials;
}
