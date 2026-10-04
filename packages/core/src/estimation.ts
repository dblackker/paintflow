import {
  EstimationInputError, type EstimationDecimal, type ExactDecimal,
  ZERO, ONE, add, subtract, multiply, divide, compare, decimal, exact,
  minor, ceil, round, boundedInteger, boundedMinor, decimalText, moneyText, allocateMinor,
} from './estimation-decimal';

export { EstimationInputError, moneyText as formatEstimationMinor } from './estimation-decimal';
export type { EstimationDecimal } from './estimation-decimal';
export const ESTIMATION_CALCULATION_VERSION = 'repaint-v1';
export const ESTIMATION_CALCULATION_VERSION_V2 = 'repaint-v2';
export type EstimationCalculationVersion = typeof ESTIMATION_CALCULATION_VERSION | typeof ESTIMATION_CALCULATION_VERSION_V2;
export type EstimationUnit = 'sqft' | 'linear_ft' | 'each';
export type EstimationRateBasis = 'legacy_per_coat' | 'complete_system' | 'hours_per_item';
export type EstimationMaterialSellingPolicy = 'purchase' | 'consumption';
export type EstimationOperationKind = 'application' | 'primer' | 'prep' | 'setup' | 'masking' | 'cut_in' | 'cleanup' | 'mobilization' | 'equipment' | 'subcontract' | 'other';
export interface EstimationProvenance {
  source?: string;
  sourceId?: string;
  version?: string;
  effectiveAt?: string;
  priceDate?: string;
  coverageSource?: string;
  note?: string;
}

export interface EstimationLabor {
  productionRateId?: string;
  productionRatePerHour: EstimationDecimal;
  sellingRate: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  prepMultiplier?: EstimationDecimal;
  productivity?: EstimationDecimal;
  adjustmentHours?: EstimationDecimal;
  rateBasis?: EstimationRateBasis;
  coatRates?: Record<string, EstimationDecimal>;
  applicationMethod?: string;
  rateVersion?: string;
  sellingRateSource?: 'inherit' | 'override';
  burdenedRateSource?: 'inherit' | 'override';
  provenance?: EstimationProvenance;
}

export interface EstimationOperation {
  id: string;
  kind: EstimationOperationKind;
  description?: string;
  quantity?: EstimationDecimal;
  unit?: EstimationUnit;
  coats?: number;
  /** Explicit total hours at this scope, not hours per coat or measured unit. */
  hours?: EstimationDecimal;
  labor?: EstimationLabor;
  sellingRate?: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  adjustmentHours?: EstimationDecimal;
  applicationMethod?: string;
  provenance?: EstimationProvenance;
}

export interface EstimationCoatingLayer {
  id: string;
  phase: 'finish' | 'primer';
  coats: number;
  /** Coating takeoff in the surface unit; independent of labor takeoff. */
  quantity?: EstimationDecimal;
  material: EstimationMaterial;
  provenance?: EstimationProvenance;
}

export interface EstimationMaterial {
  productId: string;
  variantId?: string;
  sheen?: string;
  colorName?: string;
  colorCode?: string;
  colorSupplier?: string;
  phase?: 'finish' | 'primer';
  substrateRestriction?: string;
  coveragePerPack?: EstimationDecimal;
  coveragePerGallon?: EstimationDecimal;
  coverageBasis?: 'per_gallon' | 'per_pack';
  coverageUnit: EstimationUnit;
  packSizeGallons: EstimationDecimal;
  costPerPack?: EstimationDecimal;
  markupPercent?: EstimationDecimal;
  allowancePercent?: EstimationDecimal;
  lossAllowancePercent?: EstimationDecimal;
  provisionalColorGroup?: string;
  costUnknown?: boolean;
  sellingPolicy?: EstimationMaterialSellingPolicy;
  provenance?: EstimationProvenance;
}

export interface EstimationSurface {
  id: string;
  quantity: EstimationDecimal;
  unit: EstimationUnit;
  coats: number;
  optional?: boolean;
  selected?: boolean;
  coatingWidthInches?: EstimationDecimal;
  coatingSqFtPerItem?: EstimationDecimal;
  labor: EstimationLabor;
  operations?: EstimationOperation[];
  coatingLayers?: EstimationCoatingLayer[];
  colorRelationship?: 'same' | 'different' | 'unconfirmed';
  provenance?: EstimationProvenance;
  material?: EstimationMaterial;
  materialAllowance?: { costPerMeasuredUnit: EstimationDecimal; markupPercent?: EstimationDecimal };
}

export interface EstimationAdjustment {
  id: string;
  quantity: EstimationDecimal;
  unitPrice: EstimationDecimal;
  optional?: boolean;
  selected?: boolean;
  costPerUnit?: EstimationDecimal;
  hoursPerUnit?: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  costUnknown?: boolean;
  provenance?: EstimationProvenance;
}

export interface EstimationRequest {
  calculationVersion?: EstimationCalculationVersion;
  materialSellingPolicy?: EstimationMaterialSellingPolicy;
  minimumPrice?: EstimationDecimal;
  currency?: 'USD';
  surfaces: EstimationSurface[];
  adjustments?: EstimationAdjustment[];
  discount?: EstimationDecimal;
  taxRate?: { value: EstimationDecimal; kind: 'fraction' | 'percent' };
}

export interface EstimationCostReview {
  costComplete: boolean;
  knownDirectCostMinor: number;
  directCostMinor: number | null;
  missingCostComponents: string[];
  grossMarginMinor: number | null;
  grossMarginPercent: string | null;
}

export interface EstimationOperationResult {
  id: string;
  kind: EstimationOperationKind;
  description?: string;
  quantity: string;
  unit: EstimationUnit;
  coats: number;
  hours: string;
  rateBasis: EstimationRateBasis | 'direct_hours';
  selectedRate?: string;
  productionRateId?: string;
  coatRates?: Record<string, EstimationDecimal>;
  applicationMethod?: string;
  sellingRate: string;
  burdenedRate: string | null;
  laborMinor: number;
  laborBudgetMinor: number | null;
  rateVersion?: string;
  sellingRateSource?: 'inherit' | 'override';
  burdenedRateSource?: 'inherit' | 'override';
  provenance?: EstimationProvenance;
}

export interface EstimationLayerResult {
  id: string;
  phase: 'finish' | 'primer';
  coats: number;
  quantity: string;
  productId: string;
  variantId?: string;
  sheen?: string;
  colorName?: string;
  colorCode?: string;
  colorSupplier?: string;
  substrateRestriction?: string;
  materialGroupId: string;
  coveragePerGallon: string;
  coveragePerPack: string;
  coverageBasis: 'per_gallon' | 'per_pack';
  coverageUnit: EstimationUnit;
  packSizeGallons: string;
  lossAllowancePercent: string;
  theoreticalGallons: string;
  orderGallons: string;
  theoreticalPacks: string;
  allocatedPacks: string;
  purchasedGallons: string;
  consumptionCostMinor: number | null;
  acquisitionCostMinor: number | null;
  sellingPriceMinor: number;
  materialSellingPolicy: EstimationMaterialSellingPolicy;
  provisionalColorGroup?: string;
  costComplete: boolean;
  provenance?: EstimationProvenance;
}

export interface EstimationItemResult {
  id: string;
  included: boolean;
  quantity: string;
  unit: EstimationUnit | 'adjustment';
  hours: string;
  laborMinor: number;
  laborBudgetMinor: number | null;
  materialMinor: number;
  materialCostMinor: number;
  adjustmentMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  materialGroupId?: string;
  theoreticalPacks?: string;
  theoreticalGallons?: string;
  allocatedPacks?: string;
  operations?: EstimationOperationResult[];
  layers?: EstimationLayerResult[];
  colorRelationship?: EstimationSurface['colorRelationship'];
  orderGallons?: string;
  purchasedGallons?: string;
  consumptionCostMinor?: number | null;
  acquisitionCostMinor?: number | null;
  costComplete?: boolean;
  knownDirectCostMinor?: number;
  directCostMinor?: number | null;
  missingCostComponents?: string[];
  grossMarginMinor?: number | null;
  grossMarginPercent?: string | null;
  provenance?: EstimationProvenance;
}

export interface EstimationPurchaseGroup {
  id: string;
  included: boolean;
  productId: string;
  variantId?: string;
  colorName?: string;
  colorCode?: string;
  phase: 'finish' | 'primer';
  packSizeGallons: string;
  allowancePercent: string;
  theoreticalPacks: string;
  theoreticalGallons: string;
  packCount: number;
  purchasedGallons: string;
  acquisitionCostMinor: number;
  sellingPriceMinor: number;
  itemIds: string[];
  orderGallons?: string;
  orderPacks?: string;
  leftoverGallons?: string;
  consumptionCostMinor?: number | null;
  acquisitionBudgetMinor?: number | null;
  coveragePerGallon?: string;
  coveragePerPack?: string;
  coverageUnit?: EstimationUnit;
  materialSellingPolicy?: EstimationMaterialSellingPolicy;
  costComplete?: boolean;
  provisionalColorGroup?: string;
  layerIds?: string[];
  provenance?: EstimationProvenance;
}

export interface EstimationResult {
  calculationVersion: EstimationCalculationVersion;
  currency: 'USD';
  items: EstimationItemResult[];
  purchaseGroups: EstimationPurchaseGroup[];
  materialSellingPolicy?: EstimationMaterialSellingPolicy;
  warnings: Array<{ code: 'MISSING_PRODUCT' | 'UNKNOWN_COLOR' | 'PROVISIONAL_COLOR_GROUP' | 'UNKNOWN_COST' | 'UNCONFIRMED_COLOR_RELATIONSHIP' | 'STALE_PRICE'; itemId: string; componentId?: string }>;
  totals: {
    hours: string;
    laborMinor: number;
    laborBudgetMinor: number | null;
    materialMinor: number;
    materialCostMinor: number;
    adjustmentMinor: number;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    optionalSubtotalMinor: number;
    optionalTaxMinor: number;
    theoreticalGallons?: string;
    orderGallons?: string;
    purchasedGallons?: string;
    consumptionCostMinor?: number | null;
    acquisitionCostMinor?: number | null;
    extraCostMinor?: number | null;
    costComplete?: boolean;
    knownDirectCostMinor?: number;
    directCostMinor?: number | null;
    missingCostComponents?: string[];
    grossMarginMinor?: number | null;
    grossMarginPercent?: string | null;
  };
}

export function estimationUnit(value: string): EstimationUnit {
  if (value !== 'sqft' && value !== 'linear_ft' && value !== 'each') {
    throw new EstimationInputError('unit', 'Select square feet, linear feet, or an item count.');
  }
  return value;
}

export function resolveEstimationMeasurement(input: {
  unit: EstimationUnit;
  width?: EstimationDecimal;
  height?: EstimationDecimal;
  quantity?: EstimationDecimal;
}): { width: string; height: string; quantity: string; unit: EstimationUnit } {
  const unit = estimationUnit(input.unit);
  const width = decimal(input.width == null || input.width === '' ? '0' : input.width, 'width');
  const height = decimal(input.height == null || input.height === '' ? '0' : input.height, 'height');
  const quantity = input.quantity != null && input.quantity !== ''
    ? decimal(input.quantity, 'quantity')
    : unit === 'sqft' ? multiply(width, height) : unit === 'linear_ft' ? width : ZERO;
  return { width: decimalText(width), height: decimalText(height), quantity: decimalText(quantity, 12), unit };
}

function money(value: EstimationDecimal, field: string): ExactDecimal {
  return decimal(value, field, { scale: 2 });
}

function percent(value: EstimationDecimal, field: string, maximum = 200): ExactDecimal {
  const parsed = decimal(value, field, { scale: 6 });
  if (compare(parsed, exact(BigInt(maximum))) > 0) throw new EstimationInputError(field, `Enter a percentage no greater than ${maximum}.`);
  return divide(parsed, exact(100n));
}

function coatingQuantity(surface: EstimationSurface, quantity: ExactDecimal, material: EstimationMaterial): ExactDecimal {
  estimationUnit(material.coverageUnit);
  if (surface.unit === material.coverageUnit) return quantity;
  if (material.coverageUnit !== 'sqft') throw new EstimationInputError(`${surface.id}.material.coverageUnit`, 'The product coverage unit must match the measurement unit.');
  if (surface.unit === 'linear_ft' && surface.coatingWidthInches != null && surface.coatingWidthInches !== '') {
    return multiply(quantity, divide(decimal(surface.coatingWidthInches, `${surface.id}.coatingWidthInches`, { positive: true }), exact(12n)));
  }
  if (surface.unit === 'each' && surface.coatingSqFtPerItem != null && surface.coatingSqFtPerItem !== '') {
    return multiply(quantity, decimal(surface.coatingSqFtPerItem, `${surface.id}.coatingSqFtPerItem`, { positive: true }));
  }
  throw new EstimationInputError(`${surface.id}.material`, surface.unit === 'linear_ft'
    ? 'Enter the painted width in inches to calculate paint for linear trim.'
    : 'Enter the painted square feet per item to calculate paint for counted substrates.');
}

function identity(value?: string): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function colorIdentity(value?: string): string {
  const normalized = identity(value);
  return ['tbd', 'unknown', 'n/a', 'not selected'].includes(normalized) ? '' : normalized;
}

function materialGroupKey(surface: EstimationSurface, material: EstimationMaterial, included: boolean): string {
  const color = colorIdentity(material.colorCode) || colorIdentity(material.colorName);
  return JSON.stringify([
    included ? 'base' : `option:${surface.id}`, material.productId, material.variantId || '',
    identity(material.sheen), material.phase || 'finish', identity(material.substrateRestriction),
    identity(material.colorSupplier), color ? [colorIdentity(material.colorCode), colorIdentity(material.colorName)] : `unknown:${surface.id}`,
    material.coverageUnit, decimalText(decimal(material.coveragePerPack!, 'coveragePerPack', { positive: true })),
    decimalText(decimal(material.packSizeGallons, 'packSizeGallons', { positive: true })),
    moneyText(minor(money(material.costPerPack!, 'costPerPack'), 'costPerPack')),
    decimalText(decimal(material.markupPercent ?? '0', 'markupPercent')),
    decimalText(decimal(material.allowancePercent ?? '0', 'allowancePercent')),
  ]);
}

function sumMinor(items: EstimationItemResult[], field: keyof Pick<EstimationItemResult, 'laborMinor' | 'materialMinor' | 'materialCostMinor' | 'adjustmentMinor' | 'subtotalMinor' | 'taxMinor'>): number {
  return boundedMinor(items.reduce((sum, item) => sum + BigInt(item[field]), 0n), field);
}

export function calculateProductionEstimate(request: EstimationRequest): EstimationResult {
  if (request.calculationVersion === ESTIMATION_CALCULATION_VERSION_V2) return calculateProductionEstimateV2(request);
  if (request.calculationVersion != null && request.calculationVersion !== ESTIMATION_CALCULATION_VERSION) {
    throw new EstimationInputError('calculationVersion', 'Select a supported calculation version.');
  }
  return calculateProductionEstimateV1(request);
}

function calculateProductionEstimateV1(request: EstimationRequest, adjustmentLimit = 200): EstimationResult {
  if (request.currency != null && request.currency !== 'USD') throw new EstimationInputError('currency', 'Only USD is supported.');
  if (!Array.isArray(request.surfaces) || request.surfaces.length > 500 || (request.adjustments?.length ?? 0) > adjustmentLimit) {
    throw new EstimationInputError('items', 'Use no more than 500 substrates and 200 adjustments.');
  }
  const warnings: EstimationResult['warnings'] = [];
  const items: EstimationItemResult[] = [];
  const ids = new Set<string>();
  let totalHours = ZERO;
  const groups = new Map<string, { material: EstimationMaterial; included: boolean; shares: Array<{ id: string; weight: ExactDecimal }> }>();

  function validateId(id: string) {
    if (typeof id !== 'string' || !id.trim() || id.length > 150 || ids.has(id)) throw new EstimationInputError('id', 'Every scope item needs a unique ID.');
    ids.add(id);
  }

  for (const surface of request.surfaces) {
    validateId(surface.id);
    const unit = estimationUnit(surface.unit);
    const quantity = decimal(surface.quantity, `${surface.id}.quantity`, { scale: 12 });
    if (!Number.isInteger(surface.coats) || surface.coats < 1 || surface.coats > 3) throw new EstimationInputError(`${surface.id}.coats`, 'Select one, two, or three coats.');
    const rate = decimal(surface.labor.productionRatePerHour, `${surface.id}.productionRatePerHour`, { positive: true });
    const sellingRate = money(surface.labor.sellingRate, `${surface.id}.sellingRate`);
    const burdenedRate = surface.labor.burdenedRate == null ? null : money(surface.labor.burdenedRate, `${surface.id}.burdenedRate`);
    const prep = decimal(surface.labor.prepMultiplier ?? '1', `${surface.id}.prepMultiplier`, { positive: true });
    const productivity = decimal(surface.labor.productivity ?? '1', `${surface.id}.productivity`, { positive: true });
    const adjustment = decimal(surface.labor.adjustmentHours ?? '0', `${surface.id}.adjustmentHours`, { signed: true });
    const rawHours = add(multiply(divide(quantity, multiply(rate, productivity)), multiply(exact(BigInt(surface.coats)), prep)), adjustment);
    const hours = quantity.numerator === 0n || rawHours.numerator < 0n ? ZERO : rawHours;
    const included = !surface.optional || surface.selected === true;
    if (included) totalHours = add(totalHours, hours);
    const item: EstimationItemResult = {
      id: surface.id, included, unit, quantity: decimalText(quantity, 12), hours: decimalText(hours),
      laborMinor: minor(multiply(hours, sellingRate), `${surface.id}.labor`),
      laborBudgetMinor: burdenedRate == null ? null : minor(multiply(hours, burdenedRate), `${surface.id}.laborBudget`),
      materialMinor: 0, materialCostMinor: 0, adjustmentMinor: 0,
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
    };
    items.push(item);
    if (surface.material) {
      const material = surface.material;
      if (!material.productId?.trim()) throw new EstimationInputError(`${surface.id}.material.productId`, 'Select a paint product.');
      const coverage = decimal(material.coveragePerPack!, `${surface.id}.coveragePerPack`, { positive: true });
      decimal(material.packSizeGallons, `${surface.id}.packSizeGallons`, { positive: true });
      money(material.costPerPack!, `${surface.id}.costPerPack`);
      percent(material.markupPercent ?? '0', `${surface.id}.markupPercent`);
      const allowance = percent(material.allowancePercent ?? '0', `${surface.id}.allowancePercent`, 100);
      const coated = quantity.numerator === 0n ? ZERO : coatingQuantity(surface, quantity, material);
      const theoretical = divide(multiply(multiply(coated, exact(BigInt(surface.coats))), add(ONE, allowance)), coverage);
      if (quantity.numerator !== 0n && !colorIdentity(material.colorCode) && !colorIdentity(material.colorName)) warnings.push({ code: 'UNKNOWN_COLOR', itemId: surface.id });
      const key = materialGroupKey(surface, material, included);
      const group = groups.get(key) || { material, included, shares: [] };
      group.shares.push({ id: surface.id, weight: theoretical });
      groups.set(key, group);
      item.theoreticalPacks = decimalText(theoretical);
      item.theoreticalGallons = decimalText(multiply(theoretical, decimal(material.packSizeGallons, 'packSizeGallons')));
    } else if (quantity.numerator !== 0n) {
      warnings.push({ code: 'MISSING_PRODUCT', itemId: surface.id });
      if (surface.materialAllowance) {
        const allowance = surface.materialAllowance;
        const cost = multiply(multiply(quantity, exact(BigInt(surface.coats))), money(allowance.costPerMeasuredUnit, `${surface.id}.materialAllowance`));
        item.materialCostMinor = minor(cost, `${surface.id}.materialCost`);
        item.materialMinor = minor(multiply(cost, add(ONE, percent(allowance.markupPercent ?? '0', `${surface.id}.markupPercent`))), `${surface.id}.material`);
      }
    }
  }

  const purchaseGroups: EstimationPurchaseGroup[] = [];
  for (const [id, group] of groups) {
    const theoretical = group.shares.reduce((sum, share) => add(sum, share.weight), ZERO);
    const packs = ceil(theoretical);
    const packSize = decimal(group.material.packSizeGallons, 'packSizeGallons');
    const acquisition = multiply(exact(packs), money(group.material.costPerPack!, 'costPerPack'));
    const acquisitionCostMinor = minor(acquisition, 'materialCost');
    const sellingPriceMinor = minor(multiply(acquisition, add(ONE, percent(group.material.markupPercent ?? '0', 'markupPercent'))), 'materialPrice');
    const costs = allocateMinor(acquisitionCostMinor, group.shares);
    const prices = allocateMinor(sellingPriceMinor, group.shares);
    for (const share of group.shares) {
      const item = items.find((entry) => entry.id === share.id)!;
      item.materialGroupId = id;
      item.materialCostMinor = costs.get(share.id)!;
      item.materialMinor = prices.get(share.id)!;
      item.allocatedPacks = theoretical.numerator === 0n ? '0' : decimalText(multiply(exact(packs), divide(share.weight, theoretical)));
    }
    purchaseGroups.push({
      id, included: group.included, productId: group.material.productId, variantId: group.material.variantId,
      colorName: group.material.colorName, colorCode: group.material.colorCode, phase: group.material.phase || 'finish',
      packSizeGallons: decimalText(packSize), allowancePercent: decimalText(decimal(group.material.allowancePercent ?? '0', 'allowancePercent')),
      theoreticalPacks: decimalText(theoretical), theoreticalGallons: decimalText(multiply(theoretical, packSize)),
      packCount: boundedInteger(packs, 'packCount'), purchasedGallons: decimalText(multiply(exact(packs), packSize)),
      acquisitionCostMinor, sellingPriceMinor, itemIds: group.shares.map((share) => share.id).sort(),
    });
  }

  for (const adjustment of request.adjustments || []) {
    validateId(adjustment.id);
    const quantity = decimal(adjustment.quantity, `${adjustment.id}.quantity`);
    const adjustmentMinor = minor(multiply(quantity, money(adjustment.unitPrice, `${adjustment.id}.unitPrice`)), `${adjustment.id}.adjustment`);
    items.push({
      id: adjustment.id, included: !adjustment.optional || adjustment.selected === true,
      quantity: decimalText(quantity), unit: 'adjustment', hours: '0', laborMinor: 0, laborBudgetMinor: 0,
      materialMinor: 0, materialCostMinor: 0, adjustmentMinor,
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
    });
  }
  for (const item of items) item.subtotalMinor = boundedMinor(BigInt(item.laborMinor) + BigInt(item.materialMinor) + BigInt(item.adjustmentMinor), 'subtotal');
  const included = items.filter((item) => item.included);
  const optional = items.filter((item) => !item.included);
  const subtotalMinor = sumMinor(included, 'subtotalMinor');
  const discountMinor = minor(money(request.discount ?? '0', 'discount'), 'discount');
  if (discountMinor > subtotalMinor) throw new EstimationInputError('discount', 'The discount cannot exceed the included scope subtotal.');
  const taxKind = request.taxRate?.kind ?? 'fraction';
  if (taxKind !== 'fraction' && taxKind !== 'percent') throw new EstimationInputError('taxRate.kind', 'Specify whether the tax rate is a percentage or fraction.');
  const rawTax = decimal(request.taxRate?.value ?? '0', 'taxRate', { scale: 8 });
  const taxRate = taxKind === 'percent' ? divide(rawTax, exact(100n)) : rawTax;
  if (compare(taxRate, ONE) > 0) throw new EstimationInputError('taxRate', 'Sales tax must be between zero and 100%.');
  // Tax rates multiply cents, not dollars; round once, then allocate to the discounted lines.
  const exactTaxMinor = boundedMinor(round(multiply(exact(BigInt(subtotalMinor - discountMinor)), taxRate)), 'tax');
  const discounts = allocateMinor(discountMinor, included.map((item) => ({ id: item.id, weight: exact(BigInt(item.subtotalMinor)) })));
  const taxes = allocateMinor(exactTaxMinor, included.map((item) => ({ id: item.id, weight: exact(BigInt(item.subtotalMinor - (discounts.get(item.id) || 0))) })));
  const optionalSubtotalMinor = sumMinor(optional, 'subtotalMinor');
  const optionalTaxMinor = boundedMinor(round(multiply(exact(BigInt(optionalSubtotalMinor)), taxRate)), 'optionalTax');
  const optionalTaxes = allocateMinor(optionalTaxMinor, optional.map((item) => ({ id: item.id, weight: exact(BigInt(item.subtotalMinor)) })));
  for (const item of items) {
    item.discountMinor = discounts.get(item.id) || 0;
    item.taxMinor = item.included ? taxes.get(item.id) || 0 : optionalTaxes.get(item.id) || 0;
    item.totalMinor = boundedMinor(BigInt(item.subtotalMinor - item.discountMinor) + BigInt(item.taxMinor), 'total');
  }
  return {
    calculationVersion: ESTIMATION_CALCULATION_VERSION, currency: 'USD', items, purchaseGroups, warnings,
    totals: {
      hours: decimalText(totalHours), laborMinor: sumMinor(included, 'laborMinor'),
      laborBudgetMinor: included.some((item) => item.laborBudgetMinor == null) ? null
        : boundedMinor(included.reduce((sum, item) => sum + BigInt(item.laborBudgetMinor || 0), 0n), 'laborBudget'),
      materialMinor: sumMinor(included, 'materialMinor'), materialCostMinor: sumMinor(included, 'materialCostMinor'),
      adjustmentMinor: sumMinor(included, 'adjustmentMinor'), subtotalMinor, discountMinor,
      taxMinor: exactTaxMinor, totalMinor: boundedMinor(BigInt(subtotalMinor - discountMinor) + BigInt(exactTaxMinor), 'total'),
      optionalSubtotalMinor, optionalTaxMinor,
    },
  };
}

function costReview(known: number, missing: string[], revenue: number): EstimationCostReview {
  const missingCostComponents = [...new Set(missing)].sort();
  const costComplete = missingCostComponents.length === 0;
  const grossMarginMinor = costComplete ? boundedMinor(BigInt(revenue) - BigInt(known), 'grossMargin') : null;
  return {
    costComplete, knownDirectCostMinor: known, directCostMinor: costComplete ? known : null,
    missingCostComponents, grossMarginMinor,
    grossMarginPercent: grossMarginMinor == null || revenue <= 0 ? null
      : decimalText(multiply(divide(exact(BigInt(grossMarginMinor)), exact(BigInt(revenue))), exact(100n))),
  };
}

function validateCoats(coats: number, field: string) {
  if (!Number.isInteger(coats) || coats < 1 || coats > 3) throw new EstimationInputError(field, 'Select one, two, or three coats.');
}

function validateComponentIds(components: Array<{ id: string }>, field: string) {
  const ids = new Set<string>();
  if (!Array.isArray(components) || components.length > 100) throw new EstimationInputError(field, 'Use no more than 100 operations or layers per substrate.');
  for (const component of components) {
    if (typeof component.id !== 'string' || !component.id.trim() || component.id.length > 150 || ids.has(component.id)) {
      throw new EstimationInputError(field, 'Each operation or layer needs a unique ID within its substrate.');
    }
    ids.add(component.id);
  }
}

/** A coat table selects the complete system, or successive passes for legacy_per_coat. */
function operationHours(operation: EstimationOperation, surface: EstimationSurface): {
  hours: ExactDecimal; quantity: ExactDecimal; coats: number;
  rateBasis: EstimationOperationResult['rateBasis']; selectedRate?: string;
} {
  const field = `${surface.id}.operations.${operation.id}`;
  const quantity = decimal(operation.quantity ?? surface.quantity, `${field}.quantity`, { scale: 12 });
  const coats = operation.coats ?? (operation.kind === 'application' ? surface.coats : 1);
  validateCoats(coats, `${field}.coats`);
  const adjustment = decimal(operation.adjustmentHours ?? operation.labor?.adjustmentHours ?? '0', `${field}.adjustmentHours`, { signed: true });
  let hours: ExactDecimal;
  let selectedRate: string | undefined;
  let rateBasis: EstimationOperationResult['rateBasis'] = 'direct_hours';
  if (operation.hours != null) {
    hours = decimal(operation.hours, `${field}.hours`);
  } else {
    const labor = operation.labor;
    if (!labor) throw new EstimationInputError(`${field}.labor`, 'Provide direct hours or a production rate for this operation.');
    rateBasis = labor.rateBasis ?? 'legacy_per_coat';
    if (!['legacy_per_coat', 'complete_system', 'hours_per_item'].includes(rateBasis)) {
      throw new EstimationInputError(`${field}.rateBasis`, 'Select a supported production rate basis.');
    }
    if (rateBasis === 'hours_per_item' && (operation.unit ?? surface.unit) !== 'each') {
      throw new EstimationInputError(`${field}.unit`, 'Hours per item requires an item-count measurement.');
    }
    if (rateBasis === 'legacy_per_coat' && labor.coatRates != null) {
      hours = ZERO;
      for (let coat = 1; coat <= coats; coat++) {
        const value = labor.coatRates[String(coat)];
        if (value == null) throw new EstimationInputError(`${field}.coatRates.${coat}`, 'Provide a rate for every application pass.');
        hours = add(hours, divide(quantity, decimal(value, `${field}.coatRates.${coat}`, { positive: true })));
      }
    } else {
      const value = labor.coatRates == null ? labor.productionRatePerHour : labor.coatRates[String(coats)];
      if (value == null) throw new EstimationInputError(`${field}.coatRates.${coats}`, 'Provide a calibrated rate for the selected coat count.');
      const rate = decimal(value, `${field}.rate`, { positive: true });
      selectedRate = decimalText(rate);
      hours = rateBasis === 'hours_per_item' ? multiply(quantity, rate) : divide(quantity, rate);
      if (rateBasis === 'legacy_per_coat') hours = multiply(hours, exact(BigInt(coats)));
    }
    // Calibrated rates own method efficiency. Prep/setup are separate operations in v2.
    if (quantity.numerator === 0n) return { quantity, coats, rateBasis, selectedRate, hours: ZERO };
  }
  hours = add(hours, adjustment);
  if (hours.numerator < 0n) throw new EstimationInputError(`${field}.adjustmentHours`, 'The correction cannot make operation labor negative.');
  return { quantity, coats, rateBasis, selectedRate, hours };
}

function v2ColorKey(material: EstimationMaterial, surfaceId: string, layerId: string): unknown {
  const code = colorIdentity(material.colorCode);
  const name = colorIdentity(material.colorName);
  const supplier = identity(material.colorSupplier);
  if (code) return ['code', supplier, code];
  if (name) return ['name', supplier, name];
  if (identity(material.provisionalColorGroup)) return ['provisional', identity(material.provisionalColorGroup)];
  return ['unknown', surfaceId, layerId];
}

function calculateProductionEstimateV2(request: EstimationRequest): EstimationResult {
  if (request.currency != null && request.currency !== 'USD') throw new EstimationInputError('currency', 'Only USD is supported.');
  const surfaceLimit = Array.isArray(request.surfaces) && request.surfaces.some((surface) => surface.id === 'estimator:mobilization') ? 501 : 500;
  if (!Array.isArray(request.surfaces) || request.surfaces.length > surfaceLimit
    || (request.adjustments != null && !Array.isArray(request.adjustments)) || (request.adjustments?.length ?? 0) > 200) {
    throw new EstimationInputError('items', 'Use no more than 500 substrates and 200 adjustments.');
  }
  const materialSellingPolicy = request.materialSellingPolicy ?? 'purchase';
  if (!['purchase', 'consumption'].includes(materialSellingPolicy)) throw new EstimationInputError('materialSellingPolicy', 'Select purchase or consumption material selling.');
  const items: EstimationItemResult[] = [];
  const warnings: EstimationResult['warnings'] = [];
  const ids = new Set<string>();
  const costs = new Map<string, { known: number; missing: string[]; extra: number }>();
  const itemDemand = new Map<string, { theoretical: ExactDecimal; order: ExactDecimal; purchased: ExactDecimal }>();
  let totalHours = ZERO;
  const groups = new Map<string, {
    material: EstimationMaterial; included: boolean; coverage: ExactDecimal; packSize: ExactDecimal;
    cost: ExactDecimal | null; markup: ExactDecimal; policy: EstimationMaterialSellingPolicy;
    shares: Array<{ id: string; item: EstimationItemResult; layer: EstimationLayerResult; theoretical: ExactDecimal; weight: ExactDecimal }>;
  }>();
  function validateId(id: string) {
    if (typeof id !== 'string' || !id.trim() || id.length > 150 || ids.has(id)) throw new EstimationInputError('id', 'Every scope item needs a unique ID.');
    ids.add(id);
  }
  function incrementCost(id: string, value: number) {
    const entry = costs.get(id)!;
    entry.known = boundedMinor(BigInt(entry.known) + BigInt(value), 'directCost');
  }
  function missingCost(id: string, component: string) {
    costs.get(id)!.missing.push(component);
    warnings.push({ code: 'UNKNOWN_COST', itemId: id, componentId: component });
  }
  for (const surface of request.surfaces) {
    validateId(surface.id);
    const unit = estimationUnit(surface.unit);
    const quantity = decimal(surface.quantity, `${surface.id}.quantity`, { scale: 12 });
    validateCoats(surface.coats, `${surface.id}.coats`);
    const included = !surface.optional || surface.selected === true;
    const item: EstimationItemResult = {
      id: surface.id, included, unit, quantity: decimalText(quantity, 12), hours: '0',
      laborMinor: 0, laborBudgetMinor: 0, materialMinor: 0, materialCostMinor: 0, adjustmentMinor: 0,
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, operations: [], layers: [],
      colorRelationship: surface.colorRelationship, provenance: surface.provenance,
      theoreticalGallons: '0', orderGallons: '0', purchasedGallons: '0', consumptionCostMinor: 0, acquisitionCostMinor: 0,
    };
    items.push(item);
    costs.set(item.id, { known: 0, missing: [], extra: 0 });
    itemDemand.set(item.id, { theoretical: ZERO, order: ZERO, purchased: ZERO });
    if (surface.colorRelationship != null && !['same', 'different', 'unconfirmed'].includes(surface.colorRelationship)) {
      throw new EstimationInputError(`${surface.id}.colorRelationship`, 'Select the wall and ceiling color relationship.');
    }
    if (surface.colorRelationship === 'unconfirmed') warnings.push({ code: 'UNCONFIRMED_COLOR_RELATIONSHIP', itemId: surface.id });
    const operations = surface.operations ?? [{ id: 'application', kind: 'application' as const, labor: surface.labor }];
    validateComponentIds(operations, `${surface.id}.operations`);
    let surfaceHours = ZERO;
    for (const operation of operations) {
      if (!['application', 'primer', 'prep', 'setup', 'masking', 'cut_in', 'cleanup', 'mobilization', 'equipment', 'subcontract', 'other'].includes(operation.kind)) {
        throw new EstimationInputError(`${surface.id}.operations.${operation.id}.kind`, 'Select a supported operation type.');
      }
      const calculated = operationHours(operation, surface);
      const labor = operation.labor ?? surface.labor;
      const sellingRate = money(operation.sellingRate ?? labor.sellingRate, `${surface.id}.${operation.id}.sellingRate`);
      const rawBurdened = operation.burdenedRate ?? labor.burdenedRate;
      const burdenedRate = rawBurdened == null ? null : money(rawBurdened, `${surface.id}.${operation.id}.burdenedRate`);
      const laborMinor = minor(multiply(calculated.hours, sellingRate), 'labor');
      const laborBudgetMinor = calculated.hours.numerator === 0n ? 0
        : burdenedRate == null ? null : minor(multiply(calculated.hours, burdenedRate), 'laborBudget');
      surfaceHours = add(surfaceHours, calculated.hours);
      item.laborMinor = boundedMinor(BigInt(item.laborMinor) + BigInt(laborMinor), 'labor');
      item.laborBudgetMinor = item.laborBudgetMinor == null || laborBudgetMinor == null ? null
        : boundedMinor(BigInt(item.laborBudgetMinor) + BigInt(laborBudgetMinor), 'laborBudget');
      if (laborBudgetMinor == null) missingCost(item.id, `operations.${operation.id}.burdenedRate`);
      else incrementCost(item.id, laborBudgetMinor);
      item.operations!.push({
        id: operation.id, kind: operation.kind, description: operation.description, quantity: decimalText(calculated.quantity, 12), unit: estimationUnit(operation.unit ?? unit),
        coats: calculated.coats, hours: decimalText(calculated.hours), rateBasis: calculated.rateBasis, selectedRate: calculated.selectedRate,
        coatRates: labor.coatRates, productionRateId: labor.productionRateId,
        applicationMethod: operation.applicationMethod ?? labor.applicationMethod,
        sellingRate: decimalText(sellingRate), burdenedRate: burdenedRate == null ? null : decimalText(burdenedRate),
        laborMinor, laborBudgetMinor, rateVersion: labor.rateVersion,
        sellingRateSource: operation.sellingRate != null ? 'override' : labor.sellingRateSource,
        burdenedRateSource: operation.burdenedRate != null ? 'override' : labor.burdenedRateSource,
        provenance: operation.provenance ?? labor.provenance,
      });
    }
    item.hours = decimalText(surfaceHours);
    if (included) totalHours = add(totalHours, surfaceHours);
    const layers = surface.coatingLayers ?? (surface.material ? [{
      id: surface.material.phase ?? 'finish', phase: surface.material.phase ?? 'finish', coats: surface.coats, material: surface.material,
    }] : []);
    validateComponentIds(layers, `${surface.id}.coatingLayers`);
    const requiresCoating = operations.some((operation) => operation.kind === 'application' || operation.kind === 'primer');
    if (layers.length === 0 && requiresCoating && quantity.numerator > 0n) {
      warnings.push({ code: 'MISSING_PRODUCT', itemId: item.id });
      if (surface.materialAllowance) {
        const allowance = surface.materialAllowance;
        const cost = multiply(multiply(quantity, exact(BigInt(surface.coats))), money(allowance.costPerMeasuredUnit, `${surface.id}.materialAllowance`));
        item.materialCostMinor = minor(cost, 'materialCost');
        item.acquisitionCostMinor = item.materialCostMinor;
        item.consumptionCostMinor = item.materialCostMinor;
        item.materialMinor = minor(multiply(cost, add(ONE, percent(allowance.markupPercent ?? '0', 'markupPercent'))), 'material');
        incrementCost(item.id, item.materialCostMinor);
      } else {
        item.acquisitionCostMinor = null;
        item.consumptionCostMinor = null;
        missingCost(item.id, 'material');
      }
    }
    for (const layer of layers) {
      const field = `${surface.id}.coatingLayers.${layer.id}`;
      validateCoats(layer.coats, `${field}.coats`);
      if (layer.phase !== 'finish' && layer.phase !== 'primer') throw new EstimationInputError(`${field}.phase`, 'Select primer or finish.');
      const material = { ...layer.material, phase: layer.phase };
      if (!material.productId?.trim()) throw new EstimationInputError(`${field}.material.productId`, 'Select a paint product.');
      const packSize = decimal(material.packSizeGallons, `${field}.packSizeGallons`, { positive: true });
      const coverageBasis = material.coverageBasis ?? (material.coveragePerGallon != null ? 'per_gallon' : 'per_pack');
      if (!['per_gallon', 'per_pack'].includes(coverageBasis)) throw new EstimationInputError(`${field}.coverageBasis`, 'Select per gallon or per pack coverage.');
      const coverage = coverageBasis === 'per_gallon'
        ? decimal(material.coveragePerGallon!, `${field}.coveragePerGallon`, { positive: true })
        : divide(decimal(material.coveragePerPack!, `${field}.coveragePerPack`, { positive: true }), packSize);
      const loss = percent(material.lossAllowancePercent ?? material.allowancePercent ?? '0', `${field}.lossAllowancePercent`, 100);
      const markup = percent(material.markupPercent ?? '0', `${field}.markupPercent`);
      const cost = material.costUnknown || material.costPerPack == null ? null : money(material.costPerPack, `${field}.costPerPack`);
      const policy = material.sellingPolicy ?? materialSellingPolicy;
      if (!['purchase', 'consumption'].includes(policy)) throw new EstimationInputError(`${field}.sellingPolicy`, 'Select purchase or consumption material selling.');
      const layerQuantity = decimal(layer.quantity ?? surface.quantity, `${field}.quantity`, { scale: 12 });
      const coated = layerQuantity.numerator === 0n ? ZERO : coatingQuantity(surface, layerQuantity, material);
      const theoretical = divide(multiply(coated, exact(BigInt(layer.coats))), coverage);
      const order = multiply(theoretical, add(ONE, loss));
      const demand = itemDemand.get(item.id)!;
      demand.theoretical = add(demand.theoretical, theoretical);
      demand.order = add(demand.order, order);
      if (theoretical.numerator > 0n && !colorIdentity(material.colorCode) && !colorIdentity(material.colorName)) {
        warnings.push({ code: identity(material.provisionalColorGroup) ? 'PROVISIONAL_COLOR_GROUP' : 'UNKNOWN_COLOR', itemId: item.id, componentId: layer.id });
      }
      const key = JSON.stringify([
        included ? 'base' : `option:${surface.id}`, material.productId, material.variantId ?? '', identity(material.sheen), layer.phase,
        identity(material.substrateRestriction), v2ColorKey(material, surface.id, layer.id), material.coverageUnit,
        `${coverage.numerator}/${coverage.denominator}`, decimalText(packSize), cost == null ? 'unknown' : decimalText(cost), decimalText(markup), policy,
      ]);
      const layerResult: EstimationLayerResult = {
        id: layer.id, phase: layer.phase, coats: layer.coats, quantity: decimalText(layerQuantity, 12), productId: material.productId,
        variantId: material.variantId, sheen: material.sheen, colorName: material.colorName, colorCode: material.colorCode,
        colorSupplier: material.colorSupplier, substrateRestriction: material.substrateRestriction,
        materialGroupId: key, coveragePerGallon: decimalText(coverage), coveragePerPack: decimalText(multiply(coverage, packSize)),
        coverageBasis, coverageUnit: material.coverageUnit, packSizeGallons: decimalText(packSize),
        lossAllowancePercent: decimalText(multiply(loss, exact(100n))), theoreticalGallons: decimalText(theoretical),
        orderGallons: decimalText(order), theoreticalPacks: decimalText(divide(theoretical, packSize)),
        allocatedPacks: '0', purchasedGallons: '0', consumptionCostMinor: 0, acquisitionCostMinor: 0, sellingPriceMinor: 0,
        materialSellingPolicy: policy, provisionalColorGroup: material.provisionalColorGroup,
        costComplete: cost != null || theoretical.numerator === 0n, provenance: layer.provenance ?? material.provenance,
      };
      item.layers!.push(layerResult);
      if (!layerResult.costComplete) missingCost(item.id, `coatingLayers.${layer.id}.costPerPack`);
      const group = groups.get(key) ?? { material, included, coverage, packSize, cost, markup, policy, shares: [] };
      group.shares.push({ id: JSON.stringify([surface.id, layer.id]), item, layer: layerResult, theoretical, weight: order });
      groups.set(key, group);
    }
  }
  const purchaseGroups: EstimationPurchaseGroup[] = [];
  let totalTheoretical = ZERO;
  let totalOrder = ZERO;
  let totalPurchased = ZERO;
  for (const [id, group] of groups) {
    const theoretical = group.shares.reduce((sum, share) => add(sum, share.theoretical), ZERO);
    const order = group.shares.reduce((sum, share) => add(sum, share.weight), ZERO);
    const packs = ceil(divide(order, group.packSize));
    const purchased = multiply(exact(packs), group.packSize);
    const costComplete = group.cost != null || packs === 0n;
    const acquisition = multiply(exact(packs), group.cost ?? ZERO);
    // Consumption selling uses pre-loss demand; acquisition always budgets the whole order.
    const consumption = multiply(divide(theoretical, group.packSize), group.cost ?? ZERO);
    const acquisitionCostMinor = minor(acquisition, 'materialCost');
    const consumptionCostMinor = minor(consumption, 'consumptionCost');
    const sellingPriceMinor = minor(multiply(group.policy === 'purchase' ? acquisition : consumption, add(ONE, group.markup)), 'materialPrice');
    const allocations = allocateMinor(acquisitionCostMinor, group.shares);
    const consumptionShares = group.shares.map((share) => ({ id: share.id, weight: share.theoretical }));
    const consumptionAllocations = allocateMinor(consumptionCostMinor, consumptionShares);
    const prices = allocateMinor(sellingPriceMinor, group.policy === 'purchase' ? group.shares : consumptionShares);
    for (const share of group.shares) {
      const item = share.item;
      const cost = allocations.get(share.id)!;
      const consumedCost = consumptionAllocations.get(share.id)!;
      const price = prices.get(share.id)!;
      const shareCostComplete = costComplete || share.weight.numerator === 0n;
      const allocatedPacks = order.numerator === 0n ? ZERO : multiply(exact(packs), divide(share.weight, order));
      const demand = itemDemand.get(item.id)!;
      demand.purchased = add(demand.purchased, multiply(allocatedPacks, group.packSize));
      Object.assign(share.layer, {
        allocatedPacks: decimalText(allocatedPacks), purchasedGallons: decimalText(multiply(allocatedPacks, group.packSize)),
        consumptionCostMinor: shareCostComplete ? consumedCost : null, acquisitionCostMinor: shareCostComplete ? cost : null, sellingPriceMinor: price,
      });
      item.materialCostMinor = boundedMinor(BigInt(item.materialCostMinor) + BigInt(cost), 'materialCost');
      item.materialMinor = boundedMinor(BigInt(item.materialMinor) + BigInt(price), 'material');
      item.acquisitionCostMinor = item.acquisitionCostMinor == null || !shareCostComplete ? null
        : boundedMinor(BigInt(item.acquisitionCostMinor) + BigInt(cost), 'acquisitionCost');
      item.consumptionCostMinor = item.consumptionCostMinor == null || !shareCostComplete ? null
        : boundedMinor(BigInt(item.consumptionCostMinor) + BigInt(consumedCost), 'consumptionCost');
      incrementCost(item.id, cost);
    }
    if (group.included) {
      totalTheoretical = add(totalTheoretical, theoretical);
      totalOrder = add(totalOrder, order);
      totalPurchased = add(totalPurchased, purchased);
    }
    const effectiveLoss = theoretical.numerator === 0n ? ZERO : multiply(subtract(divide(order, theoretical), ONE), exact(100n));
    purchaseGroups.push({
      id, included: group.included, productId: group.material.productId, variantId: group.material.variantId,
      colorName: group.material.colorName, colorCode: group.material.colorCode, phase: group.material.phase ?? 'finish',
      packSizeGallons: decimalText(group.packSize), allowancePercent: decimalText(effectiveLoss),
      theoreticalPacks: decimalText(divide(theoretical, group.packSize)), theoreticalGallons: decimalText(theoretical),
      orderPacks: decimalText(divide(order, group.packSize)), orderGallons: decimalText(order),
      packCount: boundedInteger(packs, 'packCount'), purchasedGallons: decimalText(purchased), leftoverGallons: decimalText(subtract(purchased, order)),
      acquisitionCostMinor, sellingPriceMinor, acquisitionBudgetMinor: costComplete ? acquisitionCostMinor : null,
      consumptionCostMinor: costComplete ? consumptionCostMinor : null, costComplete,
      coveragePerGallon: decimalText(group.coverage), coveragePerPack: decimalText(multiply(group.coverage, group.packSize)),
      coverageUnit: group.material.coverageUnit, materialSellingPolicy: group.policy,
      provisionalColorGroup: group.material.provisionalColorGroup, provenance: group.material.provenance,
      itemIds: [...new Set(group.shares.map((share) => share.item.id))].sort(), layerIds: group.shares.map((share) => share.id).sort(),
    });
  }
  for (const item of items) {
    const layers = item.layers!;
    const demand = itemDemand.get(item.id)!;
    item.theoreticalGallons = decimalText(demand.theoretical);
    item.orderGallons = decimalText(demand.order);
    item.purchasedGallons = decimalText(demand.purchased);
    if (layers.length === 1) {
      item.materialGroupId = layers[0].materialGroupId;
      item.theoreticalPacks = layers[0].theoreticalPacks;
      item.allocatedPacks = layers[0].allocatedPacks;
    }
  }
  for (const adjustment of request.adjustments ?? []) {
    validateId(adjustment.id);
    const quantity = decimal(adjustment.quantity, `${adjustment.id}.quantity`);
    const hours = multiply(quantity, decimal(adjustment.hoursPerUnit ?? '0', `${adjustment.id}.hoursPerUnit`));
    const burdened = adjustment.burdenedRate == null ? null : money(adjustment.burdenedRate, `${adjustment.id}.burdenedRate`);
    const laborBudgetMinor = hours.numerator === 0n ? 0 : burdened == null ? null : minor(multiply(hours, burdened), 'laborBudget');
    const costKnown = quantity.numerator === 0n || (!adjustment.costUnknown && adjustment.costPerUnit != null);
    const extraCostMinor = minor(multiply(quantity, adjustment.costPerUnit == null ? ZERO : money(adjustment.costPerUnit, `${adjustment.id}.costPerUnit`)), 'extraCost');
    const item: EstimationItemResult = {
      id: adjustment.id, included: !adjustment.optional || adjustment.selected === true,
      quantity: decimalText(quantity), unit: 'adjustment', hours: decimalText(hours), laborMinor: 0, laborBudgetMinor,
      materialMinor: 0, materialCostMinor: 0,
      adjustmentMinor: minor(multiply(quantity, money(adjustment.unitPrice, `${adjustment.id}.unitPrice`)), 'adjustment'),
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, provenance: adjustment.provenance,
    };
    items.push(item);
    costs.set(item.id, { known: 0, missing: [], extra: costKnown ? extraCostMinor : 0 });
    if (!costKnown) missingCost(item.id, 'costPerUnit');
    else incrementCost(item.id, extraCostMinor);
    if (laborBudgetMinor == null) missingCost(item.id, 'burdenedRate');
    else incrementCost(item.id, laborBudgetMinor);
    if (item.included) totalHours = add(totalHours, hours);
  }
  for (const item of items) item.subtotalMinor = boundedMinor(BigInt(item.laborMinor) + BigInt(item.materialMinor) + BigInt(item.adjustmentMinor), 'subtotal');
  const minimumMinor = minor(money(request.minimumPrice ?? '0', 'minimumPrice'), 'minimumPrice');
  const sellingSubtotal = sumMinor(items.filter((item) => item.included), 'subtotalMinor');
  const hasIncludedScope = items.some((item) => item.included && (item.quantity !== '0' || item.hours !== '0'));
  if (hasIncludedScope && minimumMinor > sellingSubtotal) {
    const id = 'estimator:minimum';
    validateId(id);
    const adjustmentMinor = boundedMinor(BigInt(minimumMinor) - BigInt(sellingSubtotal), 'minimumPrice');
    items.push({
      id, included: true, quantity: '1', unit: 'adjustment', hours: '0', laborMinor: 0, laborBudgetMinor: 0,
      materialMinor: 0, materialCostMinor: 0, adjustmentMinor, subtotalMinor: adjustmentMinor, discountMinor: 0, taxMinor: 0, totalMinor: 0,
      provenance: { source: 'minimum_price', note: 'Pre-discount, pre-tax selling floor; no additional work or cost assumption.' },
    });
    costs.set(id, { known: 0, missing: [], extra: 0 });
  }
  // Reuse the v1 cents allocator and commercial policy without reimplementing tax/discount.
  const commercial = calculateProductionEstimateV1({
    currency: request.currency, surfaces: [], discount: request.discount, taxRate: request.taxRate,
    adjustments: items.map((item) => ({ id: item.id, quantity: '1', unitPrice: moneyText(item.subtotalMinor), optional: !item.included })),
  }, 702);
  const commercialItems = new Map(commercial.items.map((item) => [item.id, item]));
  for (const item of items) {
    const priced = commercialItems.get(item.id)!;
    item.discountMinor = priced.discountMinor;
    item.taxMinor = priced.taxMinor;
    item.totalMinor = priced.totalMinor;
    const cost = costs.get(item.id)!;
    Object.assign(item, costReview(cost.known, cost.missing, item.subtotalMinor - item.discountMinor));
  }
  const included = items.filter((item) => item.included);
  const known = boundedMinor(included.reduce((sum, item) => sum + BigInt(costs.get(item.id)!.known), 0n), 'directCost');
  const nullableSum = (field: 'consumptionCostMinor' | 'acquisitionCostMinor') => included.some((item) => item[field] === null) ? null
    : boundedMinor(included.reduce((sum, item) => sum + BigInt(item[field] ?? 0), 0n), field);
  return {
    calculationVersion: ESTIMATION_CALCULATION_VERSION_V2, currency: 'USD', materialSellingPolicy, items, purchaseGroups, warnings,
    totals: {
      ...commercial.totals, hours: decimalText(totalHours), laborMinor: sumMinor(included, 'laborMinor'),
      laborBudgetMinor: included.some((item) => item.laborBudgetMinor == null) ? null
        : boundedMinor(included.reduce((sum, item) => sum + BigInt(item.laborBudgetMinor ?? 0), 0n), 'laborBudget'),
      materialMinor: sumMinor(included, 'materialMinor'), materialCostMinor: sumMinor(included, 'materialCostMinor'),
      adjustmentMinor: sumMinor(included, 'adjustmentMinor'), theoreticalGallons: decimalText(totalTheoretical),
      orderGallons: decimalText(totalOrder), purchasedGallons: decimalText(totalPurchased),
      consumptionCostMinor: nullableSum('consumptionCostMinor'), acquisitionCostMinor: nullableSum('acquisitionCostMinor'),
      extraCostMinor: included.some((item) => costs.get(item.id)!.missing.includes('costPerUnit')) ? null
        : boundedMinor(included.reduce((sum, item) => sum + BigInt(costs.get(item.id)!.extra), 0n), 'extraCost'),
      ...costReview(known, included.flatMap((item) => costs.get(item.id)!.missing.map((component) => `${item.id}.${component}`)),
        commercial.totals.subtotalMinor - commercial.totals.discountMinor),
    },
  };
}
