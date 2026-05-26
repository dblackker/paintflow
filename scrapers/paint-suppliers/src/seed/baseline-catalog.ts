import { Color, ColorSchema, Pricing, PricingSchema, Product, ProductColorMapping, ProductSchema } from '../suppliers/base';

const effectiveDate = new Date().toISOString().slice(0, 10);

const products: Product[] = [
  {
    id: 'sherwin-williams:superpaint-interior-acrylic-latex',
    supplierId: 'sherwin-williams',
    sku: 'A87W01151',
    name: 'SuperPaint Interior Acrylic Latex',
    productLine: 'SuperPaint',
    type: 'interior',
    category: 'paint',
    sheens: ['flat', 'eggshell', 'satin', 'semi-gloss'],
    bases: ['extra white', 'deep base', 'ultra deep'],
    description: 'Professional interior acrylic latex paint commonly used for residential repaints.',
    features: ['Good hide and coverage', 'Washable finish', 'Low VOC'],
    url: 'https://www.sherwin-williams.com/homeowners/products/superpaint-interior-acrylic-latex',
  },
  {
    id: 'sherwin-williams:duration-exterior-acrylic-latex',
    supplierId: 'sherwin-williams',
    sku: 'A97W00151',
    name: 'Duration Exterior Acrylic Latex',
    productLine: 'Duration',
    type: 'exterior',
    category: 'paint',
    sheens: ['flat', 'satin', 'semi-gloss'],
    bases: ['extra white', 'deep base', 'ultra deep'],
    description: 'Premium exterior acrylic latex paint for siding, trim, and repaint projects.',
    features: ['Self-priming on many surfaces', 'Mildew-resistant coating', 'Fade resistance'],
    url: 'https://www.sherwin-williams.com/homeowners/products/duration-exterior-acrylic-latex',
  },
  {
    id: 'sherwin-williams:emerald-urethane-trim-enamel',
    supplierId: 'sherwin-williams',
    sku: 'K38W00751',
    name: 'Emerald Urethane Trim Enamel',
    productLine: 'Emerald',
    type: 'specialty',
    category: 'paint',
    sheens: ['satin', 'semi-gloss', 'gloss'],
    bases: ['extra white', 'deep base', 'ultra deep'],
    description: 'Waterbased urethane enamel used for trim, doors, cabinets, and high-touch surfaces.',
    features: ['Hard durable finish', 'Good leveling', 'Interior/exterior use'],
    url: 'https://www.sherwin-williams.com/homeowners/products/emerald-urethane-trim-enamel',
  },
  {
    id: 'benjamin-moore:regal-select-interior',
    supplierId: 'benjamin-moore',
    sku: 'F549',
    name: 'Regal Select Interior Paint',
    productLine: 'Regal Select',
    type: 'interior',
    category: 'paint',
    sheens: ['flat', 'matte', 'eggshell', 'pearl', 'semi-gloss'],
    bases: ['white', 'pastel base', 'medium base', 'deep base'],
    description: 'Premium Benjamin Moore interior paint line for walls and trim-ready finishes.',
    features: ['Good hide', 'Washable finish', 'Low VOC'],
    url: 'https://www.benjaminmoore.com/en-us/interior-paints-stains/regal-select',
  },
  {
    id: 'benjamin-moore:aura-interior',
    supplierId: 'benjamin-moore',
    sku: 'F524',
    name: 'Aura Interior Paint',
    productLine: 'Aura',
    type: 'interior',
    category: 'paint',
    sheens: ['matte', 'eggshell', 'satin', 'semi-gloss'],
    bases: ['white', 'pastel base', 'medium base', 'deep base'],
    description: 'Premium interior paint with Benjamin Moore Color Lock technology.',
    features: ['Excellent hide', 'Rich color', 'Washable finish'],
    url: 'https://www.benjaminmoore.com/en-us/interior-paints-stains/aura-interior-paint',
  },
  {
    id: 'benjamin-moore:ben-exterior',
    supplierId: 'benjamin-moore',
    sku: 'N541',
    name: 'Ben Exterior Paint',
    productLine: 'Ben',
    type: 'exterior',
    category: 'paint',
    sheens: ['flat', 'low lustre', 'soft gloss'],
    bases: ['white', 'pastel base', 'medium base', 'deep base'],
    description: 'Exterior acrylic paint used for common residential exterior repaint work.',
    features: ['Mildew-resistant coating', 'Good color retention'],
    url: 'https://www.benjaminmoore.com/en-us/exterior-paints-stains/ben-exterior-paint',
  },
  {
    id: 'ppg:manor-hall-interior',
    supplierId: 'ppg',
    sku: '70-810',
    name: 'Manor Hall Interior Paint',
    productLine: 'Manor Hall',
    type: 'interior',
    category: 'paint',
    sheens: ['flat', 'eggshell', 'satin', 'semi-gloss'],
    bases: ['white', 'pastel', 'mid-tone', 'deep'],
    description: 'PPG interior paint line used for durable residential wall finishes.',
    features: ['Stain resistant', 'Low odor', 'Good touch-up'],
    url: 'https://www.ppgpaints.com/products/interior-paint',
  },
  {
    id: 'ppg:timeless-exterior',
    supplierId: 'ppg',
    sku: 'PPG-TIMELESS-EXT',
    name: 'Timeless Exterior Paint',
    productLine: 'Timeless',
    type: 'exterior',
    category: 'paint',
    sheens: ['flat', 'satin', 'semi-gloss'],
    bases: ['white', 'pastel', 'mid-tone', 'deep'],
    description: 'PPG exterior paint and primer line for residential exterior projects.',
    features: ['Paint and primer', 'UV resistance', 'Mildew-resistant coating'],
    url: 'https://www.ppgpaints.com/products/exterior-paint',
  },
];

const colors: Color[] = [
  { id: 'sherwin-williams:sw-7008', supplierId: 'sherwin-williams', colorCode: 'SW 7008', name: 'Alabaster', hexCode: '#EDEAE0', family: 'whites', collection: 'Top 50 Colors', lrv: 82, isPopular: true },
  { id: 'sherwin-williams:sw-7005', supplierId: 'sherwin-williams', colorCode: 'SW 7005', name: 'Pure White', hexCode: '#F4F1E8', family: 'whites', collection: 'Top 50 Colors', lrv: 84, isPopular: true },
  { id: 'sherwin-williams:sw-7015', supplierId: 'sherwin-williams', colorCode: 'SW 7015', name: 'Repose Gray', hexCode: '#CCC9C0', family: 'grays', collection: 'Top 50 Colors', lrv: 58, isPopular: true },
  { id: 'sherwin-williams:sw-7069', supplierId: 'sherwin-williams', colorCode: 'SW 7069', name: 'Iron Ore', hexCode: '#434341', family: 'blacks', collection: 'Top 50 Colors', lrv: 6, isPopular: true },
  { id: 'sherwin-williams:sw-6204', supplierId: 'sherwin-williams', colorCode: 'SW 6204', name: 'Sea Salt', hexCode: '#CDD2CA', family: 'greens', collection: 'Top 50 Colors', lrv: 63, isPopular: true },
  { id: 'benjamin-moore:oc-65', supplierId: 'benjamin-moore', colorCode: 'OC-65', name: 'Chantilly Lace', hexCode: '#F5F3EE', family: 'whites', collection: 'Off White Collection', lrv: 90, isPopular: true },
  { id: 'benjamin-moore:oc-117', supplierId: 'benjamin-moore', colorCode: 'OC-117', name: 'Simply White', hexCode: '#F4F1E4', family: 'whites', collection: 'Off White Collection', lrv: 90, isPopular: true },
  { id: 'benjamin-moore:hc-172', supplierId: 'benjamin-moore', colorCode: 'HC-172', name: 'Revere Pewter', hexCode: '#CBC6B8', family: 'neutrals', collection: 'Historical Collection', lrv: 55, isPopular: true },
  { id: 'benjamin-moore:hc-154', supplierId: 'benjamin-moore', colorCode: 'HC-154', name: 'Hale Navy', hexCode: '#2F3B43', family: 'blues', collection: 'Historical Collection', lrv: 8, isPopular: true },
  { id: 'benjamin-moore:hc-166', supplierId: 'benjamin-moore', colorCode: 'HC-166', name: 'Kendall Charcoal', hexCode: '#4D4B48', family: 'grays', collection: 'Historical Collection', lrv: 13, isPopular: true },
  { id: 'ppg:1001-1', supplierId: 'ppg', colorCode: 'PPG1001-1', name: 'Delicate White', hexCode: '#F4F2EA', family: 'whites', collection: 'Voice of Color', lrv: 88, isPopular: true },
  { id: 'ppg:1001-4', supplierId: 'ppg', colorCode: 'PPG1001-4', name: 'Flagstone', hexCode: '#ACAAA0', family: 'grays', collection: 'Voice of Color', lrv: 39, isPopular: true },
  { id: 'ppg:1160-6', supplierId: 'ppg', colorCode: 'PPG1160-6', name: 'Chinese Porcelain', hexCode: '#3E4F5C', family: 'blues', collection: 'Voice of Color', lrv: 10, isPopular: true },
];

const prices: Pricing[] = [
  ['sherwin-williams:superpaint-interior-acrylic-latex', 5899],
  ['sherwin-williams:duration-exterior-acrylic-latex', 7499],
  ['sherwin-williams:emerald-urethane-trim-enamel', 9299],
  ['benjamin-moore:regal-select-interior', 6499],
  ['benjamin-moore:aura-interior', 8299],
  ['benjamin-moore:ben-exterior', 5499],
  ['ppg:manor-hall-interior', 5599],
  ['ppg:timeless-exterior', 6199],
].map(([productId, priceCents]) => ({
  productId: String(productId),
  size: '1 gallon',
  priceCents: Number(priceCents),
  currency: 'USD',
  tier: 'baseline',
  effectiveDate,
}));

function requiredBase(lrv?: number): string {
  if (lrv == null) return 'extra-white';
  if (lrv < 15) return 'ultra-deep';
  if (lrv < 50) return 'deep-base';
  if (lrv < 75) return 'medium-base';
  return 'extra-white';
}

const mappings: ProductColorMapping[] = products.flatMap((product) => (
  colors
    .filter((color) => color.supplierId === product.supplierId)
    .map((color) => ({
      productId: product.id,
      colorId: color.id,
      isAvailable: true,
      baseRequired: requiredBase(color.lrv),
      recommendedUse: product.type === 'specialty' ? ['interior', 'exterior'] : [product.type],
    }))
));

export function baselineCatalog() {
  return {
    products: products.map((product) => ProductSchema.parse(product)),
    pricing: prices.map((price) => PricingSchema.parse(price)),
    colors: colors.map((color) => ColorSchema.parse(color)),
    productColors: mappings,
  };
}
