import {
  calculateProductionEstimate, estimationUnit, resolveEstimationMeasurement,
  EstimationInputError, type EstimationDecimal, type EstimationRequest,
  type EstimationCalculationVersion, type EstimationMaterialSellingPolicy, type EstimationRateBasis,
  type EstimationOperationKind, type EstimationProvenance, type EstimationLabor, type EstimationMaterial,
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
  colorSupplier?: string;
  provisionalColorGroup?: string;
  colorRelationship?: 'same' | 'different' | 'unconfirmed';
  sellingRate?: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  operations?: ProductionPreviewOperation[];
  coatingLayers?: ProductionPreviewCoatingLayer[];
  optional?: boolean;
  selected?: boolean;
}

export interface ProductionPreviewOperation {
  id: string;
  kind: EstimationOperationKind;
  description?: string;
  productionRateId?: string;
  quantity?: EstimationDecimal;
  unit?: string;
  coats?: number;
  hours?: EstimationDecimal;
  applicationMethod?: string;
  sellingRate?: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  adjustmentHours?: EstimationDecimal;
  provenance?: EstimationProvenance;
}

export interface ProductionPreviewCoatingLayer {
  id: string;
  phase: 'primer' | 'finish';
  materialId: string;
  coats: number;
  quantity?: EstimationDecimal;
  coveragePerGallon?: EstimationDecimal;
  coveragePerPack?: EstimationDecimal;
  coverageUnit?: 'sqft' | 'linear_ft' | 'each';
  lossAllowancePercent?: EstimationDecimal;
  colorName?: string;
  colorCode?: string;
  colorSupplier?: string;
  provisionalColorGroup?: string;
  substrateRestriction?: string;
  provenance?: EstimationProvenance;
}

export interface ProductionPreviewRequest {
  calculationVersion?: EstimationCalculationVersion;
  materialSellingPolicy?: EstimationMaterialSellingPolicy;
  minimumPrice?: EstimationDecimal;
  mobilizationHours?: EstimationDecimal;
  /** Explicit pricing clock keeps preview/saved calculations deterministic. */
  pricingAsOf?: string;
  jobsitePostalCode?: string;
  taxOverride?: { ratePercent: EstimationDecimal; reason: string };
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
    rateBasis?: EstimationRateBasis | null;
    coatRates?: Record<string, EstimationDecimal> | null;
    applicationMethod?: string | null;
    rateVersion?: string | null;
    sellingRateSource?: 'inherit' | 'override' | null;
    burdenedRate?: EstimationDecimal | null;
    burdenedRateSource?: 'inherit' | 'override' | null;
    provenance?: EstimationProvenance | null;
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
    coverageBasis?: 'per_gallon' | 'per_pack' | null;
    coveragePerGallon?: EstimationDecimal | null;
    packSizeGallons?: EstimationDecimal | null;
    lossAllowancePercent?: EstimationDecimal | null;
    provenance?: EstimationProvenance | null;
    priceSource?: string | null;
    priceUpdatedAt?: string | Date | null;
    coverageSource?: string | null;
    markupPercent?: EstimationDecimal | null;
    isActive?: boolean | null;
  }>;
  settings: {
    defaultLaborRate?: EstimationDecimal | null;
    defaultBurdenedLaborRate?: EstimationDecimal | null;
    defaultBurdenedRate?: EstimationDecimal | null;
    burdenedRate?: EstimationDecimal | null;
    minimumPrice?: EstimationDecimal | null;
    mobilizationHours?: EstimationDecimal | null;
    priceStaleDays?: number | null;
    materialSellingPolicy?: EstimationMaterialSellingPolicy | null;
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
  if (request.calculationVersion === 'repaint-v2') return calculateProductionPreviewV2(request, catalog);
  if (request.calculationVersion != null && request.calculationVersion !== 'repaint-v1') {
    throw new EstimationInputError('calculationVersion', 'Select a supported calculation version.');
  }
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

function calculateProductionPreviewV2(request: ProductionPreviewRequest, catalog: ProductionPreviewCatalog) {
  if (!Array.isArray(request.items) || request.items.length > 500) throw new EstimationInputError('items', 'Use no more than 500 substrates.');
  const rateMap = new Map(catalog.rates.filter((rate) => rate.isActive !== false).map((rate) => [rate.id, rate]));
  const materialMap = new Map(catalog.materials.filter((material) => material.isActive !== false).map((material) => [material.id, material]));
  const defaultBurdened = catalog.settings.defaultBurdenedRate !== undefined ? catalog.settings.defaultBurdenedRate
    : catalog.settings.burdenedRate !== undefined ? catalog.settings.burdenedRate : catalog.settings.defaultBurdenedLaborRate;
  function laborFor(rateId: string, field: string, override: {
    sellingRate?: EstimationDecimal; burdenedRate?: EstimationDecimal; applicationMethod?: string;
  } = {}): { labor: EstimationLabor; unit: ReturnType<typeof estimationUnit>; coats: number } {
    const rate = rateMap.get(rateId);
    if (!rate) throw new EstimationInputError(`${field}.productionRateId`, 'This production rate is unavailable. Select an active substrate.');
    const sellingSource = override.sellingRate != null ? 'override'
      : rate.sellingRateSource ?? (rate.hourlyRate != null ? 'override' : 'inherit');
    const burdenedSource = override.burdenedRate != null ? 'override'
      : rate.burdenedRateSource ?? (rate.burdenedRate != null ? 'override' : 'inherit');
    const selling = override.sellingRate ?? (sellingSource === 'inherit' ? catalog.settings.defaultLaborRate : rate.hourlyRate);
    if (selling == null) throw new EstimationInputError(`${field}.sellingRate`, 'Configure a selling labor rate or an intentional override.');
    if (rate.applicationMethod && override.applicationMethod && rate.applicationMethod !== override.applicationMethod) {
      throw new EstimationInputError(`${field}.applicationMethod`, 'The selected method does not match the calibrated production rate.');
    }
    const burdened = override.burdenedRate ?? (burdenedSource === 'inherit' ? defaultBurdened : rate.burdenedRate);
    return {
      unit: estimationUnit(rate.unit || 'sqft'), coats: Number(rate.coats ?? 2),
      labor: {
        productionRateId: rate.id, productionRatePerHour: rate.ratePerHour ?? '0', rateBasis: rate.rateBasis ?? 'legacy_per_coat',
        coatRates: rate.coatRates ?? undefined, sellingRate: selling, burdenedRate: burdened ?? undefined,
        applicationMethod: rate.applicationMethod ?? override.applicationMethod,
        rateVersion: rate.rateVersion ?? undefined, sellingRateSource: sellingSource, burdenedRateSource: burdenedSource,
        provenance: { source: 'tenant_pricebook', sourceId: rate.id, ...rate.provenance },
      },
    };
  }
  const resolvedInput: EstimationRequest = {
    calculationVersion: 'repaint-v2', currency: 'USD',
    materialSellingPolicy: request.materialSellingPolicy ?? catalog.settings.materialSellingPolicy ?? 'purchase',
    minimumPrice: request.minimumPrice ?? catalog.settings.minimumPrice ?? '0',
    discount: request.discount ?? '0', taxRate: { value: catalog.settings.salesTaxRate ?? '0', kind: 'fraction' },
    adjustments: request.adjustments,
    surfaces: request.items.map((item) => {
      const resolved = laborFor(item.productionRateId, item.id, item);
      if (item.unit && item.unit !== resolved.unit) throw new EstimationInputError(`${item.id}.unit`, 'The measurement unit does not match the selected production rate.');
      let measurement: ReturnType<typeof resolveEstimationMeasurement>;
      try {
        measurement = resolveEstimationMeasurement({ ...item, unit: resolved.unit });
      } catch (error) {
        if (!(error instanceof EstimationInputError)) throw error;
        throw new EstimationInputError(`${item.id}.${error.field}`, error.message);
      }
      const coats = item.coats ?? resolved.coats;
      const operations: NonNullable<EstimationRequest['surfaces'][number]['operations']> = item.operations == null ? [{
        id: 'application', kind: 'application', coats, labor: resolved.labor,
        adjustmentHours: item.paintAdjustmentHours,
      }] : item.operations.map((operation) => {
        const opResolved = operation.productionRateId ? laborFor(operation.productionRateId, `${item.id}.operations.${operation.id}`, operation) : resolved;
        const unit = estimationUnit(operation.unit ?? opResolved.unit);
        if (unit !== opResolved.unit) throw new EstimationInputError(`${item.id}.operations.${operation.id}.unit`, 'The operation unit does not match its production rate.');
        if (unit !== resolved.unit && operation.quantity == null) throw new EstimationInputError(`${item.id}.operations.${operation.id}.quantity`, 'Provide a takeoff for an operation with a different unit.');
        return {
          id: operation.id, kind: operation.kind, description: operation.description, quantity: operation.quantity, unit, coats: operation.coats,
          hours: operation.hours, labor: opResolved.labor, sellingRate: operation.sellingRate, burdenedRate: operation.burdenedRate,
          applicationMethod: operation.applicationMethod, adjustmentHours: operation.adjustmentHours, provenance: operation.provenance,
        };
      });
      if (item.operations != null && decimal(orZero(item.paintAdjustmentHours), `${item.id}.paintAdjustmentHours`, { signed: true }).numerator !== 0n) {
        throw new EstimationInputError(`${item.id}.paintAdjustmentHours`, 'Apply the labor correction to its explicit operation.');
      }
      const prepHours = decimal(orZero(item.prepAdjustmentHours), `${item.id}.prepAdjustmentHours`);
      if (prepHours.numerator > 0n) operations.push({ id: 'prep-adjustment', kind: 'prep', hours: decimalText(prepHours), labor: resolved.labor });
      const phase = item.materialId && materialMap.get(item.materialId)?.category === 'primer' ? 'primer' as const : 'finish' as const;
      const layers = item.coatingLayers ?? (item.materialId ? [{
        id: phase, phase, materialId: item.materialId, coats,
        colorName: item.colorName, colorCode: item.colorCode, colorSupplier: item.colorSupplier,
        provisionalColorGroup: item.provisionalColorGroup,
      }] : undefined);
      return {
        id: item.id, unit: resolved.unit, quantity: measurement.quantity, coats,
        optional: item.optional, selected: item.selected, labor: resolved.labor, operations,
        colorRelationship: item.colorRelationship,
        coatingWidthInches: item.coatingWidthInches, coatingSqFtPerItem: item.coatingSqFtPerItem,
        coatingLayers: layers?.map((layer) => {
          const product = materialMap.get(layer.materialId);
          if (!product) throw new EstimationInputError(`${item.id}.coatingLayers.${layer.id}.materialId`, 'This product is unavailable. Select an active paint product.');
          const perGallon = layer.coveragePerGallon ?? product.coveragePerGallon
            ?? (product.coverageBasis === 'per_gallon' ? product.coverageSqFt ?? undefined : undefined);
          const material: EstimationMaterial = {
            productId: product.id, variantId: product.sku || product.id, sheen: product.sheen ?? undefined,
            phase: layer.phase, colorName: layer.colorName ?? item.colorName, colorCode: layer.colorCode ?? item.colorCode,
            colorSupplier: layer.colorSupplier ?? item.colorSupplier ?? product.brand ?? undefined,
            provisionalColorGroup: layer.provisionalColorGroup ?? item.provisionalColorGroup,
            substrateRestriction: layer.substrateRestriction, coverageUnit: layer.coverageUnit ?? 'sqft',
            coverageBasis: layer.coveragePerGallon != null ? 'per_gallon' : layer.coveragePerPack != null ? 'per_pack'
              : product.coverageBasis ?? (perGallon != null ? 'per_gallon' : 'per_pack'),
            coveragePerGallon: perGallon, coveragePerPack: layer.coveragePerPack ?? product.coverageSqFt ?? undefined,
            packSizeGallons: product.packSizeGallons ?? packGallons(product.unit), costPerPack: product.costPerUnit ?? undefined,
            markupPercent: product.markupPercent ?? catalog.settings.materialMarkupPercent ?? '0',
            lossAllowancePercent: layer.lossAllowancePercent ?? product.lossAllowancePercent ?? '0',
            provenance: {
              source: product.priceSource ?? 'tenant_pricebook', sourceId: product.id,
              priceDate: product.priceUpdatedAt instanceof Date ? product.priceUpdatedAt.toISOString() : product.priceUpdatedAt ?? undefined,
              coverageSource: product.coverageSource ?? undefined, ...product.provenance,
            },
          };
          return { id: layer.id, phase: layer.phase, coats: layer.coats, quantity: layer.quantity, material, provenance: layer.provenance };
        }),
      };
    }),
  };
  const mobilization = decimal(request.mobilizationHours ?? catalog.settings.mobilizationHours ?? '0', 'mobilizationHours');
  if (mobilization.numerator > 0n) {
    if (catalog.settings.defaultLaborRate == null) throw new EstimationInputError('mobilizationHours', 'Configure the organization selling labor rate for mobilization.');
    const labor: EstimationLabor = {
      productionRatePerHour: '1', sellingRate: catalog.settings.defaultLaborRate, burdenedRate: defaultBurdened ?? undefined,
      sellingRateSource: 'inherit', burdenedRateSource: 'inherit', provenance: { source: 'organization_mobilization' },
    };
    resolvedInput.surfaces.push({
      id: 'estimator:mobilization', unit: 'each', quantity: '1', coats: 1, labor, coatingLayers: [],
      operations: [{ id: 'mobilization', kind: 'mobilization', hours: decimalText(mobilization), labor }],
      provenance: { source: 'organization_mobilization', note: 'One-time labor budget; other travel/equipment costs require explicit extras.' },
    });
  }
  const calculation = calculateProductionEstimate(resolvedInput);
  if (catalog.settings.priceStaleDays != null && (!Number.isInteger(catalog.settings.priceStaleDays) || catalog.settings.priceStaleDays < 0)) {
    throw new EstimationInputError('priceStaleDays', 'Use a nonnegative whole number of days.');
  }
  if (request.pricingAsOf != null) {
    const asOf = Date.parse(request.pricingAsOf);
    if (!Number.isFinite(asOf)) throw new EstimationInputError('pricingAsOf', 'Provide a valid pricing date.');
    if (catalog.settings.priceStaleDays != null) {
      for (const surface of resolvedInput.surfaces) {
        for (const layer of surface.coatingLayers ?? []) {
          const priceDate = layer.material.provenance?.priceDate;
          if (priceDate && asOf - Date.parse(priceDate) > catalog.settings.priceStaleDays * 86_400_000) {
            calculation.warnings.push({ code: 'STALE_PRICE', itemId: surface.id, componentId: layer.id });
          }
        }
      }
    }
  }
  return { resolvedInput, calculation };
}
