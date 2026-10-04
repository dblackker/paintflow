import {
  calculateProductionEstimate, estimationUnit, resolveEstimationMeasurement,
  EstimationInputError, type EstimationDecimal, type EstimationRequest,
} from './estimation';
import { add, decimal, decimalText, multiply } from './estimation-decimal';

export const ESTIMATION_PREP_MULTIPLIERS = { none: '0.8', light: '1', standard: '1.2', heavy: '1.5' } as const;
export const ESTIMATION_PRODUCTIVITY = { brush_roll: '1', spray_backroll: '1.35', spray_only: '1.6' } as const;

export interface ProductionPreviewItem {
  id: string;
  productionRateId: string;
  unit?: string;
  quantity?: EstimationDecimal;
  width?: EstimationDecimal;
  height?: EstimationDecimal;
  coats?: number;
  prepLevel?: keyof typeof ESTIMATION_PREP_MULTIPLIERS;
  applicationMethod?: keyof typeof ESTIMATION_PRODUCTIVITY;
  prepAdjustmentHours?: EstimationDecimal;
  paintAdjustmentHours?: EstimationDecimal;
  coatingWidthInches?: EstimationDecimal;
  coatingSqFtPerItem?: EstimationDecimal;
  materialId?: string;
  colorName?: string;
  colorCode?: string;
  optional?: boolean;
  selected?: boolean;
}

export interface ProductionPreviewRequest {
  items: ProductionPreviewItem[];
  adjustments?: EstimationRequest['adjustments'];
  discount?: EstimationDecimal;
}

export interface ProductionPreviewCatalog {
  rates: Array<{
    id: string;
    unit?: string | null;
    ratePerHour?: EstimationDecimal | null;
    hourlyRate?: EstimationDecimal | null;
    prepMultiplier?: EstimationDecimal | null;
    coats?: number | string | null;
    isActive?: boolean | null;
  }>;
  materials: Array<{
    id: string;
    category?: string | null;
    brand?: string | null;
    sku?: string | null;
    sheen?: string | null;
    unit?: string | null;
    costPerUnit?: EstimationDecimal | null;
    coverageSqFt?: EstimationDecimal | null;
    markupPercent?: EstimationDecimal | null;
    isActive?: boolean | null;
  }>;
  settings: {
    defaultLaborRate?: EstimationDecimal | null;
    materialMarkupPercent?: EstimationDecimal | null;
    salesTaxRate?: EstimationDecimal | null;
  };
}

function orZero(value?: EstimationDecimal | null): EstimationDecimal {
  return value == null || value === '' ? '0' : value;
}

function packGallons(unit?: string | null): string {
  const normalized = (unit || '').trim().toLowerCase();
  const packs: Record<string, string> = {
    gallon: '1', gallons: '1', gal: '1', '1 gallon': '1',
    quart: '0.25', quarts: '0.25', qt: '0.25',
    '5 gallon': '5', '5-gallon': '5', '5 gal': '5',
    liter: '0.264172', litre: '0.264172',
  };
  if (!packs[normalized]) throw new EstimationInputError('material.unit', 'Set this paint product pack size to gallons, quarts, five gallons, or liters.');
  return packs[normalized];
}

/** Resolve current tenant-owned pricebook data once for both the web preview and API. */
export function calculateProductionPreview(request: ProductionPreviewRequest, catalog: ProductionPreviewCatalog) {
  const rateMap = new Map(catalog.rates.filter((rate) => rate.isActive !== false).map((rate) => [rate.id, rate]));
  const materialMap = new Map(catalog.materials.filter((material) => material.isActive !== false).map((material) => [material.id, material]));
  const resolvedInput: EstimationRequest = {
    currency: 'USD',
    discount: request.discount ?? '0',
    taxRate: { value: catalog.settings.salesTaxRate ?? '0', kind: 'fraction' },
    adjustments: request.adjustments,
    surfaces: request.items.map((item) => {
      const rate = rateMap.get(item.productionRateId);
      if (!rate) throw new EstimationInputError(`${item.id}.productionRateId`, 'This production rate is unavailable. Select an active substrate.');
      const unit = estimationUnit(rate.unit || 'sqft');
      if (item.unit && item.unit !== unit) throw new EstimationInputError(`${item.id}.unit`, 'The measurement unit does not match the selected production rate.');
      let measurement: ReturnType<typeof resolveEstimationMeasurement>;
      try {
        measurement = resolveEstimationMeasurement({ ...item, unit });
      } catch (error) {
        if (!(error instanceof EstimationInputError)) throw error;
        throw new EstimationInputError(`${item.id}.${error.field}`, error.message);
      }
      const prepLevel = item.prepLevel ?? 'standard';
      const applicationMethod = item.applicationMethod ?? 'brush_roll';
      if (!(prepLevel in ESTIMATION_PREP_MULTIPLIERS)) throw new EstimationInputError(`${item.id}.prepLevel`, 'Select a valid prep level.');
      if (!(applicationMethod in ESTIMATION_PRODUCTIVITY)) throw new EstimationInputError(`${item.id}.applicationMethod`, 'Select a valid application method.');
      const material = item.materialId ? materialMap.get(item.materialId) : undefined;
      if (item.materialId && !material) throw new EstimationInputError(`${item.id}.materialId`, 'This product is unavailable. Select an active paint product.');
      if (material && (material.coverageSqFt == null || Number(material.coverageSqFt) <= 0)) {
        throw new EstimationInputError(`${item.id}.coveragePerPack`, 'Add coverage per pack to this paint product before using it.');
      }
      return {
        id: item.id,
        unit, quantity: measurement.quantity, coats: item.coats ?? Number(rate.coats ?? 2),
        optional: item.optional, selected: item.selected,
        coatingWidthInches: item.coatingWidthInches, coatingSqFtPerItem: item.coatingSqFtPerItem,
        labor: {
          productionRatePerHour: rate.ratePerHour ?? '0',
          sellingRate: rate.hourlyRate ?? catalog.settings.defaultLaborRate ?? '65',
          prepMultiplier: decimalText(multiply(decimal(rate.prepMultiplier ?? '1', 'prepMultiplier', { positive: true }), decimal(ESTIMATION_PREP_MULTIPLIERS[prepLevel], 'prepLevel'))),
          productivity: ESTIMATION_PRODUCTIVITY[applicationMethod],
          adjustmentHours: decimalText(add(
            decimal(orZero(item.prepAdjustmentHours), `${item.id}.prepAdjustmentHours`, { signed: true }),
            decimal(orZero(item.paintAdjustmentHours), `${item.id}.paintAdjustmentHours`, { signed: true }),
          )),
        },
        material: material ? {
          productId: material.id, variantId: material.sku || material.id, sheen: material.sheen || undefined,
          colorName: item.colorName, colorCode: item.colorCode, colorSupplier: material.brand || undefined,
          phase: material.category === 'primer' ? 'primer' as const : 'finish' as const,
          coveragePerPack: material.coverageSqFt!, coverageUnit: 'sqft' as const,
          packSizeGallons: packGallons(material.unit), costPerPack: material.costPerUnit ?? '0',
          markupPercent: material.markupPercent ?? catalog.settings.materialMarkupPercent ?? '0', allowancePercent: '0',
        } : undefined,
        materialAllowance: material ? undefined : {
          costPerMeasuredUnit: unit === 'linear_ft' ? '0.18' : unit === 'each' ? '8' : '0.35',
          markupPercent: catalog.settings.materialMarkupPercent ?? '0',
        },
      };
    }),
  };
  return { resolvedInput, calculation: calculateProductionEstimate(resolvedInput) };
}
