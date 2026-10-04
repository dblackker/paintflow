import { z } from 'zod';
import type { createDb } from '@crewmodo/db';
import { materials, orgSettings, productionRates } from '@crewmodo/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { EstimationInputError } from '../../../../packages/core/src/estimation';
import { calculateProductionPreview, type ProductionPreviewRequest } from '../../../../packages/core/src/estimation-production';
import { readEstimationTaxPolicy, resolveEstimationTax } from '../../../../packages/core/src/estimation-tax';

const decimalInput = z.union([z.number().finite(), z.string().trim().max(32)]);
const provenanceSchema = z.object({ source: z.string().max(120).optional(), sourceId: z.string().max(150).optional(), version: z.string().max(100).optional(), effectiveAt: z.string().max(40).optional(), priceDate: z.string().max(40).optional(), coverageSource: z.string().max(120).optional(), note: z.string().max(500).optional() });
const operationSchema = z.object({
  id: z.string().trim().min(1).max(150), kind: z.enum(['application','primer','prep','setup','masking','cut_in','cleanup','mobilization','equipment','subcontract','other']),
  description: z.string().trim().max(300).optional(),
  productionRateId: z.string().uuid().optional(), quantity: decimalInput.optional(), unit: z.enum(['sqft','linear_ft','each']).optional(), coats: z.number().int().min(1).max(3).optional(),
  hours: decimalInput.optional(), sellingRate: decimalInput.optional(), burdenedRate: decimalInput.optional(), adjustmentHours: decimalInput.optional(), applicationMethod: z.enum(['brush_roll','spray_backroll','spray_only']).optional(), provenance: provenanceSchema.optional(),
});
const layerSchema = z.object({
  id: z.string().trim().min(1).max(150), phase: z.enum(['primer','finish']), materialId: z.string().uuid(), coats: z.number().int().min(1).max(3), quantity: decimalInput.optional(),
  coveragePerGallon: decimalInput.optional(), coveragePerPack: decimalInput.optional(), coverageUnit: z.enum(['sqft','linear_ft','each']).optional(), lossAllowancePercent: decimalInput.optional(),
  colorName: z.string().trim().max(120).optional(), colorCode: z.string().trim().max(80).optional(), colorSupplier: z.string().trim().max(100).optional(), provisionalColorGroup: z.string().trim().max(100).optional(), substrateRestriction: z.string().trim().max(120).optional(), provenance: provenanceSchema.optional(),
});

export const productionCalculationSchema = z.object({
  // Presentation/recovery metadata never participates in authoritative pricing.
  editorState: z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 2_000_000, 'The saved room layout is too large.').optional(),
  calculationVersion: z.enum(['repaint-v1','repaint-v2']).optional(),
  materialSellingPolicy: z.enum(['purchase','consumption']).optional(),
  jobsitePostalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/).optional(),
  taxOverride: z.object({ ratePercent: decimalInput, reason: z.string().trim().min(3).max(500) }).optional(),
  minimumPrice: decimalInput.optional(), mobilizationHours: decimalInput.optional(), pricingAsOf: z.string().datetime({ offset: true }).optional(),
  items: z.array(z.object({
    id: z.string().trim().min(1).max(150).optional(),
    productionRateId: z.string().uuid(),
    unit: z.enum(['sqft', 'linear_ft', 'each']).optional(),
    quantity: decimalInput.optional(),
    width: decimalInput.optional(),
    height: decimalInput.optional(),
    coats: z.number().int().min(1).max(3).optional(),
    prepLevel: z.enum(['none', 'light', 'standard', 'heavy']).optional(),
    applicationMethod: z.enum(['brush_roll', 'spray_backroll', 'spray_only']).optional(),
    prepAdjustmentHours: decimalInput.optional(),
    paintAdjustmentHours: decimalInput.optional(),
    coatingWidthInches: decimalInput.optional(),
    coatingSqFtPerItem: decimalInput.optional(),
    materialId: z.union([z.string().uuid(), z.literal('')]).optional(),
    colorName: z.string().trim().max(120).optional(),
    colorCode: z.string().trim().max(80).optional(),
    colorSupplier: z.string().trim().max(100).optional(), provisionalColorGroup: z.string().trim().max(100).optional(),
    colorRelationship: z.enum(['same','different','unconfirmed']).optional(),
    sellingRate: decimalInput.optional(), burdenedRate: decimalInput.optional(),
    operations: z.array(operationSchema).min(1).max(20).optional(), coatingLayers: z.array(layerSchema).max(4).optional(),
    optional: z.boolean().optional(),
    selected: z.boolean().optional(),
  })).max(500),
  adjustments: z.array(z.object({
    id: z.string().trim().min(1).max(150),
    quantity: decimalInput,
    unitPrice: decimalInput,
    costPerUnit: decimalInput.optional(), hoursPerUnit: decimalInput.optional(), burdenedRate: decimalInput.optional(), costUnknown: z.boolean().optional(), provenance: provenanceSchema.optional(),
    optional: z.boolean().optional(),
    selected: z.boolean().optional(),
  })).max(200).optional(),
  discount: decimalInput.optional(),
});

export class ProductionEstimationValidationError extends EstimationInputError {
  constructor(readonly fieldErrors: Record<string, string[]>) {
    super('productionInput', 'Check the estimate measurements and selected rates.');
  }
}

export function parseProductionEstimationInput(input: unknown): ProductionPreviewRequest {
  const parsed = productionCalculationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'productionInput';
      fieldErrors[path] = [...(fieldErrors[path] || []), issue.message];
    }
    throw new ProductionEstimationValidationError(fieldErrors);
  }
  return {
    ...parsed.data,
    taxOverride: parsed.data.taxOverride ? { ratePercent: parsed.data.taxOverride.ratePercent!, reason: parsed.data.taxOverride.reason! } : undefined,
    items: parsed.data.items.map((item, index) => ({ ...item, id: item.id || `item-${index}`, productionRateId: item.productionRateId!,
      operations: item.operations?.map((operation) => ({ ...operation, id: operation.id!, kind: operation.kind! })),
      coatingLayers: item.coatingLayers?.map((layer) => ({ ...layer, id: layer.id!, phase: layer.phase!, materialId: layer.materialId!, coats: layer.coats! })),
    })),
    adjustments: parsed.data.adjustments?.map((item) => ({ ...item, id: item.id!, quantity: item.quantity!, unitPrice: item.unitPrice! })),
  };
}

/**
 * Preview and unsigned save use current tenant pricing. Never pass a submitted
 * calculationInput snapshot as the pricebook; signed historical snapshots stay frozen.
 */
export async function resolveProductionEstimation(db: ReturnType<typeof createDb>, orgId: string, input: unknown, context: { postalCode?: string | null; actorId?: string | null } = {}) {
  const productionInput = parseProductionEstimationInput(input);
  const rateIds = [...new Set(productionInput.items.flatMap((item) => [item.productionRateId, ...(item.operations || []).map((operation) => operation.productionRateId)]).filter((id): id is string => Boolean(id)))];
  const materialIds = [...new Set(productionInput.items.flatMap((item) => [item.materialId, ...(item.coatingLayers || []).map((layer) => layer.materialId)]).filter((id): id is string => Boolean(id)))];
  const [rates, products, settings] = await Promise.all([
    rateIds.length ? db.query.productionRates.findMany({ where: and(eq(productionRates.orgId, orgId), inArray(productionRates.id, rateIds)) }) : Promise.resolve([]),
    materialIds.length ? db.query.materials.findMany({ where: and(eq(materials.orgId, orgId), inArray(materials.id, materialIds)) }) : Promise.resolve([]),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  const preferences = settings?.businessHours && typeof settings.businessHours === 'object' ? settings.businessHours as Record<string, unknown> : {};
  const policy = preferences.estimationPricing && typeof preferences.estimationPricing === 'object' ? preferences.estimationPricing as Record<string, unknown> : {};
  const taxInput = productionInput as ProductionPreviewRequest & { jobsitePostalCode?: string; taxOverride?: { ratePercent: string | number; reason: string } };
  if (context.postalCode !== undefined) taxInput.jobsitePostalCode = context.postalCode?.match(/^\d{5}/)?.[0] || undefined;
  const taxSnapshot = resolveEstimationTax({ defaultRate: settings?.salesTaxRate, policy: productionInput.calculationVersion === 'repaint-v2' ? readEstimationTaxPolicy(preferences) : null, postalCode: taxInput.jobsitePostalCode,
    override: productionInput.calculationVersion === 'repaint-v2' ? taxInput.taxOverride : null, actorId: context.actorId });
  const preview = calculateProductionPreview({ ...productionInput, pricingAsOf: new Date().toISOString() }, {
    rates: rates.map((rate) => ({ ...rate, rateVersion: String(rate.version), provenance: { source: rate.provenance, effectiveAt: rate.reviewedAt?.toISOString(), version: String(rate.version) } })),
    materials: products.map((product) => ({ ...product, provenance: { source: product.costSource || 'contractor_pricebook', priceDate: product.costUpdatedAt?.toISOString(), coverageSource: product.coverageSource || undefined } })),
    settings: { ...settings, salesTaxRate: productionInput.calculationVersion === 'repaint-v2' ? taxSnapshot.value : settings?.salesTaxRate,
      defaultBurdenedRate: policy.defaultBurdenedRate as string | null, priceStaleDays: Number(policy.priceStaleDays ?? 90) },
  });
  return { productionInput, ...preview, rates, materials: products, taxSnapshot };
}

export function productionEstimationFieldErrors(error: EstimationInputError): Record<string, string[]> {
  return error instanceof ProductionEstimationValidationError ? error.fieldErrors : { [error.field]: [error.message] };
}
