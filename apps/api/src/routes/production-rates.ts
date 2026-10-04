import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { productionRates } from '@crewmodo/db/schema';
import { eq, and } from 'drizzle-orm';
import { EstimationInputError, formatEstimationMinor } from '../../../../packages/core/src/estimation';
import { resolveProductionEstimation, productionEstimationFieldErrors } from '../lib/production-estimation';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const ratesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
ratesApp.use('*', authMiddleware);

const rateSchema = z.object({
  category: z.string().min(1),
  surfaceType: z.string().min(1),
  unit: z.enum(['sqft', 'linear_ft', 'each']).default('sqft'),
  ratePerHour: z.number().positive(),
  hourlyRate: z.number().positive().default(50),
  prepMultiplier: z.number().positive().default(1),
  coats: z.number().int().min(1).max(3).default(2),
  description: z.string().optional(),
});

// Seed default rates
const DEFAULT_RATES = [
  { category: 'walls', surfaceType: 'drywall', unit: 'sqft', ratePerHour: 400, hourlyRate: 50, description: 'Interior walls - roll' },
  { category: 'ceilings', surfaceType: 'drywall', unit: 'sqft', ratePerHour: 300, hourlyRate: 50, description: 'Ceilings - roll' },
  { category: 'trim', surfaceType: 'wood', unit: 'linear_ft', ratePerHour: 80, hourlyRate: 50, description: 'Baseboards, crown molding' },
  { category: 'doors', surfaceType: 'wood', unit: 'each', ratePerHour: 4, hourlyRate: 50, description: 'Interior door (both sides)' },
  { category: 'cabinets', surfaceType: 'wood', unit: 'each', ratePerHour: 0.5, hourlyRate: 50, description: 'Cabinet door/drawer front' },
  { category: 'exterior_siding', surfaceType: 'wood', unit: 'sqft', ratePerHour: 200, hourlyRate: 50, description: 'Exterior siding - spray' },
  { category: 'exterior_soffit', surfaceType: 'wood or aluminum', unit: 'sqft', ratePerHour: 125, hourlyRate: 65, description: 'Exterior soffits' },
  { category: 'exterior_fascia', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: 55, hourlyRate: 65, description: 'Exterior fascia boards' },
  { category: 'exterior_trim', surfaceType: 'window and door trim', unit: 'linear_ft', ratePerHour: 50, hourlyRate: 65, description: 'Exterior window and door trim' },
  { category: 'exterior_corner_boards', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: 50, hourlyRate: 65, description: 'Exterior corner boards' },
];

ratesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  let allRates = await db.query.productionRates.findMany({
    where: eq(productionRates.orgId, orgId),
  });
  let rates = allRates.filter((rate) => rate.isActive !== false);
  
  // Seed defaults if empty
  if (allRates.length === 0) {
    const seeded = await db.insert(productionRates).values(
      DEFAULT_RATES.map(r => ({
        orgId,
        category: r.category,
        surfaceType: r.surfaceType,
        unit: r.unit,
        ratePerHour: r.ratePerHour.toString(),
        hourlyRate: r.hourlyRate.toString(),
        description: r.description,
      }))
    ).returning();
    rates = seeded;
    allRates = seeded;
  } else {
    const missingExteriorDefaults = DEFAULT_RATES.filter((defaultRate) =>
      defaultRate.category.startsWith('exterior_') &&
      !allRates.some((rate) => rate.category === defaultRate.category)
    );

    if (missingExteriorDefaults.length) {
      const seeded = await db.insert(productionRates).values(
        missingExteriorDefaults.map(r => ({
          orgId,
          category: r.category,
          surfaceType: r.surfaceType,
          unit: r.unit,
          ratePerHour: r.ratePerHour.toString(),
          hourlyRate: r.hourlyRate.toString(),
          description: r.description,
        }))
      ).returning();
      rates = [...rates, ...seeded];
      allRates = [...allRates, ...seeded];
    }
  }
  
  return c.json({ data: rates });
});

ratesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = rateSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [rate] = await db.insert(productionRates).values({
    orgId,
    category: parsed.category,
    surfaceType: parsed.surfaceType,
    unit: parsed.unit,
    coats: parsed.coats,
    description: parsed.description,
    ratePerHour: parsed.ratePerHour.toString(),
    hourlyRate: parsed.hourlyRate.toString(),
    prepMultiplier: parsed.prepMultiplier.toString(),
  }).returning();
  
  return c.json({ data: rate }, 201);
});

ratesApp.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = rateSchema.partial().parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [rate] = await db.update(productionRates)
    .set({
      ...parsed,
      ratePerHour: parsed.ratePerHour?.toString(),
      hourlyRate: parsed.hourlyRate?.toString(),
      prepMultiplier: parsed.prepMultiplier?.toString(),
      updatedAt: new Date(),
    })
    .where(and(eq(productionRates.id, id), eq(productionRates.orgId, orgId)))
    .returning();
  
  return c.json({ data: rate });
});

ratesApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  await db.update(productionRates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(productionRates.id, id), eq(productionRates.orgId, orgId)));
  
  return c.json({ success: true });
});

// Read-only preview: price/rate/tax inputs are resolved from this tenant's active pricebook.
ratesApp.post('/calculate', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  try {
    const preview = await resolveProductionEstimation(db, orgId, await c.req.json().catch(() => null));
    const resultMap = new Map(preview.calculation.items.map((item) => [item.id, item]));
    const rateMap = new Map(preview.rates.map((rate) => [rate.id, rate]));
    const items = preview.productionInput.items.map((item) => {
      const line = resultMap.get(item.id)!;
      const rate = rateMap.get(item.productionRateId)!;
      return {
        ...item, hours: Number(line.hours).toFixed(2), laborCost: formatEstimationMinor(line.laborMinor),
        materialCost: formatEstimationMinor(line.materialCostMinor), materialPrice: formatEstimationMinor(line.materialMinor),
        rateName: `${rate.category} (${rate.surfaceType})`,
      };
    });
    return c.json({ data: {
      resolvedInput: preview.resolvedInput, calculation: preview.calculation, items,
      // Keep the legacy labor-only total while exposing the complete versioned calculation.
      total: formatEstimationMinor(preview.calculation.totals.laborMinor),
      subtotal: formatEstimationMinor(preview.calculation.totals.subtotalMinor),
      tax: formatEstimationMinor(preview.calculation.totals.taxMinor),
      grandTotal: formatEstimationMinor(preview.calculation.totals.totalMinor),
    } });
  } catch (error) {
    if (!(error instanceof EstimationInputError)) throw error;
    return c.json({ error: error.message, code: error.code, fieldErrors: productionEstimationFieldErrors(error) }, 400);
  }
});

export default ratesApp;
