import { z } from 'zod';
import type { createDb } from '@crewmodo/db';
import { materials, orgSettings, productionRates } from '@crewmodo/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { EstimationInputError } from '../../../../packages/core/src/estimation';
import { calculateProductionPreview, type ProductionPreviewRequest } from '../../../../packages/core/src/estimation-production';

const decimalInput = z.union([z.number().finite(), z.string().trim().max(32)]);

export const productionCalculationSchema = z.object({
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
    optional: z.boolean().optional(),
    selected: z.boolean().optional(),
  })).max(500),
  adjustments: z.array(z.object({
    id: z.string().trim().min(1).max(150),
    quantity: decimalInput,
    unitPrice: decimalInput,
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
    items: parsed.data.items.map((item, index) => ({ ...item, id: item.id || `item-${index}`, productionRateId: item.productionRateId! })),
    adjustments: parsed.data.adjustments?.map((item) => ({ ...item, id: item.id!, quantity: item.quantity!, unitPrice: item.unitPrice! })),
  };
}

/**
 * Preview and unsigned save use current tenant pricing. Never pass a submitted
 * calculationInput snapshot as the pricebook; signed historical snapshots stay frozen.
 */
export async function resolveProductionEstimation(db: ReturnType<typeof createDb>, orgId: string, input: unknown) {
  const productionInput = parseProductionEstimationInput(input);
  const rateIds = [...new Set(productionInput.items.map((item) => item.productionRateId))];
  const materialIds = [...new Set(productionInput.items.map((item) => item.materialId).filter(Boolean))];
  const [rates, products, settings] = await Promise.all([
    rateIds.length ? db.query.productionRates.findMany({ where: and(eq(productionRates.orgId, orgId), inArray(productionRates.id, rateIds)) }) : Promise.resolve([]),
    materialIds.length ? db.query.materials.findMany({ where: and(eq(materials.orgId, orgId), inArray(materials.id, materialIds)) }) : Promise.resolve([]),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  const preview = calculateProductionPreview(productionInput, { rates, materials: products, settings: settings || {} });
  return { productionInput, ...preview, rates, materials: products };
}

export function productionEstimationFieldErrors(error: EstimationInputError): Record<string, string[]> {
  return error instanceof ProductionEstimationValidationError ? error.fieldErrors : { [error.field]: [error.message] };
}
