import { decimal, decimalText, divide, exact } from './estimation-decimal';

/** Starter tables assume equal-speed passes; prep and setup are budgeted separately. */
export function starterCoatRates(perCoatOutput: string): Record<string, string> {
  const output = decimal(perCoatOutput, 'starterOutput', { positive: true });
  return Object.fromEntries([1, 2, 3].map((coats) => [String(coats), decimalText(divide(output, exact(BigInt(coats))), 6)]));
}

// Starting allowances, not calibrated company productivity or verified labor costs.
export const STARTER_PRODUCTION_RATES = ([
  { category: 'walls', surfaceType: 'interior drywall', unit: 'sqft', ratePerHour: '400.00', applicationMethod: 'brush_roll', description: 'Interior walls, brush and roll' },
  { category: 'ceilings', surfaceType: 'interior drywall', unit: 'sqft', ratePerHour: '300.00', applicationMethod: 'brush_roll', description: 'Flat ceilings, brush and roll' },
  { category: 'trim', surfaceType: 'painted wood', unit: 'linear_ft', ratePerHour: '80.00', applicationMethod: 'brush_roll', description: 'Baseboards, casing, and crown trim' },
  { category: 'doors', surfaceType: 'interior wood', unit: 'each', ratePerHour: '4.00', applicationMethod: 'brush_roll', description: 'Interior slab door, both sides' },
  { category: 'cabinets', surfaceType: 'wood cabinet fronts', unit: 'each', ratePerHour: '0.50', applicationMethod: 'brush_roll', description: 'Cabinet door or drawer front' },
  { category: 'exterior_siding', surfaceType: 'exterior siding', unit: 'sqft', ratePerHour: '200.00', applicationMethod: 'spray_backroll', description: 'Exterior siding, spray and back-roll' },
  { category: 'exterior_soffit', surfaceType: 'wood or aluminum', unit: 'sqft', ratePerHour: '125.00', applicationMethod: 'brush_roll', description: 'Exterior soffits' },
  { category: 'exterior_fascia', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: '55.00', applicationMethod: 'brush_roll', description: 'Exterior fascia boards' },
  { category: 'exterior_trim', surfaceType: 'window and door trim', unit: 'linear_ft', ratePerHour: '50.00', applicationMethod: 'brush_roll', description: 'Exterior window and door trim' },
  { category: 'exterior_corner_boards', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: '50.00', applicationMethod: 'brush_roll', description: 'Exterior corner boards' },
] as const).map((rate) => ({
  ...rate,
  hourlyRate: '65.00',
  prepMultiplier: '1.00',
  coats: 2,
  rateBasis: 'complete_system' as const,
  coatRates: starterCoatRates(rate.ratePerHour),
  sellingRateSource: 'inherit' as const,
  burdenedRate: null,
  provenance: 'sample' as const,
  reviewedAt: null,
}));
