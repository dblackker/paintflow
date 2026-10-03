import {
  EstimationInputError, type EstimationDecimal, type ExactDecimal,
  ZERO, ONE, add, subtract, multiply, divide, compare, decimal, exact,
  minor, ceil, round, boundedInteger, boundedMinor, decimalText, moneyText, allocateMinor,
} from './estimation-decimal';

export { EstimationInputError, moneyText as formatEstimationMinor } from './estimation-decimal';
export type { EstimationDecimal } from './estimation-decimal';
export const ESTIMATION_CALCULATION_VERSION = 'repaint-v1';
export type EstimationUnit = 'sqft' | 'linear_ft' | 'each';

export interface EstimationMaterial {
  productId: string;
  variantId?: string;
  sheen?: string;
  colorName?: string;
  colorCode?: string;
  colorSupplier?: string;
  phase?: 'finish' | 'primer';
  substrateRestriction?: string;
  coveragePerPack: EstimationDecimal;
  coverageUnit: EstimationUnit;
  packSizeGallons: EstimationDecimal;
  costPerPack: EstimationDecimal;
  markupPercent?: EstimationDecimal;
  allowancePercent?: EstimationDecimal;
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
  labor: {
    productionRatePerHour: EstimationDecimal;
    sellingRate: EstimationDecimal;
    burdenedRate?: EstimationDecimal;
    prepMultiplier?: EstimationDecimal;
    productivity?: EstimationDecimal;
    adjustmentHours?: EstimationDecimal;
  };
  material?: EstimationMaterial;
  materialAllowance?: { costPerMeasuredUnit: EstimationDecimal; markupPercent?: EstimationDecimal };
}

export interface EstimationAdjustment {
  id: string;
  quantity: EstimationDecimal;
  unitPrice: EstimationDecimal;
  optional?: boolean;
  selected?: boolean;
}

export interface EstimationRequest {
  currency?: 'USD';
  surfaces: EstimationSurface[];
  adjustments?: EstimationAdjustment[];
  discount?: EstimationDecimal;
  taxRate?: { value: EstimationDecimal; kind: 'fraction' | 'percent' };
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
}

export interface EstimationResult {
  calculationVersion: typeof ESTIMATION_CALCULATION_VERSION;
  currency: 'USD';
  items: EstimationItemResult[];
  purchaseGroups: EstimationPurchaseGroup[];
  warnings: Array<{ code: 'MISSING_PRODUCT' | 'UNKNOWN_COLOR'; itemId: string }>;
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
    material.coverageUnit, decimalText(decimal(material.coveragePerPack, 'coveragePerPack', { positive: true })),
    decimalText(decimal(material.packSizeGallons, 'packSizeGallons', { positive: true })),
    moneyText(minor(money(material.costPerPack, 'costPerPack'), 'costPerPack')),
    decimalText(decimal(material.markupPercent ?? '0', 'markupPercent')),
    decimalText(decimal(material.allowancePercent ?? '0', 'allowancePercent')),
  ]);
}

function sumMinor(items: EstimationItemResult[], field: keyof Pick<EstimationItemResult, 'laborMinor' | 'materialMinor' | 'materialCostMinor' | 'adjustmentMinor' | 'subtotalMinor' | 'taxMinor'>): number {
  return boundedMinor(items.reduce((sum, item) => sum + BigInt(item[field]), 0n), field);
}

export function calculateProductionEstimate(request: EstimationRequest): EstimationResult {
  if (request.currency != null && request.currency !== 'USD') throw new EstimationInputError('currency', 'Only USD is supported.');
  if (!Array.isArray(request.surfaces) || request.surfaces.length > 500 || (request.adjustments?.length ?? 0) > 200) {
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
      const coverage = decimal(material.coveragePerPack, `${surface.id}.coveragePerPack`, { positive: true });
      decimal(material.packSizeGallons, `${surface.id}.packSizeGallons`, { positive: true });
      money(material.costPerPack, `${surface.id}.costPerPack`);
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
    const acquisition = multiply(exact(packs), money(group.material.costPerPack, 'costPerPack'));
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
