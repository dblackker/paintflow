import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { productionRates } from '@crewmodo/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { EstimationInputError, formatEstimationMinor } from '../../../../packages/core/src/estimation';
import { STARTER_PRODUCTION_RATES } from '../../../../packages/core/src/estimation-rate-defaults';
import { resolveProductionEstimation, productionEstimationFieldErrors } from '../lib/production-estimation';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { requireOrgPermission } from '../middleware/financial-access';
import { camelRecord } from '../lib/supplier-operations';

const ratesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
ratesApp.use('*', authMiddleware);

function decimalValue(scale: number, maximum: number, allowZero = false) {
  return z
    .union([z.number().finite(), z.string().trim().max(32)])
    .transform((value) => String(value))
    .superRefine((value, ctx) => {
      if (
        !new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value) ||
        !Number.isFinite(Number(value)) ||
        Number(value) > maximum ||
        (allowZero ? Number(value) < 0 : Number(value) <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enter ${allowZero ? 'a nonnegative' : 'a positive'} value up to ${maximum} with at most ${scale} decimal places.`,
        });
      }
    })
    .transform((value) => String(Number(value)));
}

const outputRate = decimalValue(2, 99999999.99);
const moneyRate = decimalValue(2, 99999999.99);
const coatRateTable = z.record(z.enum(['1', '2', '3']), decimalValue(6, 99999999.99));
const rateFields = z.object({
  category: z.string().trim().min(1).max(100),
  surfaceType: z.string().trim().min(1).max(100),
  unit: z.enum(['sqft', 'linear_ft', 'each']).default('sqft'),
  ratePerHour: outputRate,
  hourlyRate: moneyRate.default('50'),
  prepMultiplier: decimalValue(2, 999.99).default('1'),
  coats: z.number().int().min(1).max(3).default(2),
  description: z.string().trim().max(4000).nullable().optional(),
  rateBasis: z.enum(['legacy_per_coat', 'complete_system', 'hours_per_item']).default('legacy_per_coat'),
  coatRates: coatRateTable.default({}),
  applicationMethod: z.enum(['brush_roll', 'spray_backroll', 'spray_only']).nullable().default(null),
  sellingRateSource: z.enum(['inherit', 'override']).default('override'),
  burdenedRate: decimalValue(2, 99999999.99, true).nullable().default(null),
  reviewed: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const productionRateSchema = rateFields.superRefine((rate, ctx) => {
  if (rate.rateBasis === 'hours_per_item' && rate.unit !== 'each') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unit'],
      message: 'Hours per item requires the each unit.',
    });
  }
  if (rate.rateBasis !== 'legacy_per_coat' && !rate.coatRates[String(rate.coats)]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coatRates', String(rate.coats)],
      message: 'Enter a complete-system rate for the default coat count.',
    });
  }
  if (rate.rateBasis === 'legacy_per_coat' && Object.keys(rate.coatRates).length > 0) {
    for (let pass = 1; pass <= rate.coats; pass++) {
      if (!rate.coatRates[String(pass)]) ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coatRates', String(pass)],
        message: `Enter a rate for application pass ${pass}, or leave the table empty to use units/hour per coat.`,
      });
    }
  }
});

export function normalizeProductionRate(
  input: unknown,
  existing?: Record<string, unknown>,
  now = new Date(),
) {
  const parsed = productionRateSchema.parse(
    existing ? { ...existing, ...rateFields.partial().parse(input) } : input,
  );
  const { reviewed, expectedVersion: _expectedVersion, ...fields } = parsed;
  return {
    ...fields,
    description: fields.description || null,
    // Nothing in a legacy description establishes a calibrated method or coat basis.
    provenance: reviewed === true ? 'manual' : String(existing?.provenance || 'manual'),
    reviewedAt:
      reviewed === true ? now.toISOString() : reviewed === false ? null : (existing?.reviewedAt ?? null),
  };
}

export const SAMPLE_PRODUCTION_RATES = STARTER_PRODUCTION_RATES;

const pricebookAccess = requireOrgPermission(
  ['manage_settings'],
  'Ask an owner for permission to manage production rates.',
);
type RateContext = Context<{ Bindings: Env; Variables: Variables }>;

export function productionPricebookOperationKey(value?: string) {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new PricebookOperationError('A valid Idempotency-Key is required.', 400, 'INVALID_OPERATION_KEY');
  return key;
}

class PricebookOperationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly code: string,
  ) {
    super(message);
  }
}

function pricebookError(c: RateContext, error: unknown) {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || 'rate';
      fieldErrors[path] = [...(fieldErrors[path] || []), issue.message];
    }
    return c.json({ error: 'Check the production rate values.', fieldErrors, code: 'INVALID_RATE' }, 400);
  }
  if (error instanceof PricebookOperationError)
    return c.json({ error: error.message, code: error.code }, error.status);
  const cause = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = cause?.code || cause?.cause?.code;
  if (code === 'P0400' || code === 'P0404' || code === 'P0409') {
    return c.json(
      { error: cause.cause?.message || cause.message, code: 'PRICEBOOK_OPERATION_CONFLICT' },
      code === 'P0404' ? 404 : code === 'P0409' ? 409 : 400,
    );
  }
  throw error;
}

async function queuePricebookEvent(c: RateContext, action: string, key: string) {
  if (c.env.POSTHOG_ENABLED !== 'true' || !c.env.POSTHOG_PROJECT_TOKEN) return;
  const host = c.env.POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host)) return;
  const opaque = async (value: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  const actor = await opaque(`crewmodo:actor:${c.get('orgId')}:${c.get('userId')}`);
  const outcome = await opaque(`crewmodo:pricebook:${actor}:${action}:${key}`);
  const pending = fetch(`${host}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      api_key: c.env.POSTHOG_PROJECT_TOKEN,
      event: `production.pricebook.${action}`,
      distinct_id: actor,
      uuid: `${outcome.slice(0, 8)}-${outcome.slice(8, 12)}-5${outcome.slice(13, 16)}-8${outcome.slice(17, 20)}-${outcome.slice(20, 32)}`,
      properties: { $process_person_profile: false, schema_version: 1 },
    }),
  }).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(pending);
  } catch {
    void pending;
  }
}

async function mutatePricebook(
  c: RateContext,
  action: string,
  request: unknown,
  payload: unknown,
  id: string | null = null,
  expectedVersion: number | null = null,
) {
  const key = productionPricebookOperationKey(c.req.header('Idempotency-Key'));
  const db = createDb(c.env.DATABASE_URL);
  const result = await db.execute(sql`select mutate_production_pricebook(
    ${c.get('orgId')}::uuid, ${c.get('userId')}::uuid, ${key}, ${action}, ${JSON.stringify(request)}::jsonb,
    ${id}::uuid, ${expectedVersion}::integer, ${JSON.stringify(payload)}::jsonb
  ) as result`);
  const outcome = result.rows[0].result as {
    data: Record<string, unknown> | Array<Record<string, unknown>>;
    replayed: boolean;
  };
  const data = Array.isArray(outcome.data)
    ? outcome.data.map((row) => camelRecord(row))
    : camelRecord(outcome.data);
  if (!outcome.replayed) await queuePricebookEvent(c, action, key);
  if (action === 'delete') return c.json({ success: true, replayed: outcome.replayed });
  return c.json({ data, replayed: outcome.replayed }, action === 'create' && !outcome.replayed ? 201 : 200);
}

ratesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const rates = await db.query.productionRates.findMany({
    where: and(eq(productionRates.orgId, orgId), eq(productionRates.isActive, true)),
  });
  return c.json({ data: rates });
});

ratesApp.post('/initialize-samples', pricebookAccess, async (c) => {
  try {
    productionPricebookOperationKey(c.req.header('Idempotency-Key'));
    return await mutatePricebook(c, 'initialize-samples', {}, SAMPLE_PRODUCTION_RATES);
  } catch (error) {
    return pricebookError(c, error);
  }
});

ratesApp.post('/', pricebookAccess, async (c) => {
  try {
    productionPricebookOperationKey(c.req.header('Idempotency-Key'));
    const body = await c.req.json().catch(() => null);
    return await mutatePricebook(c, 'create', body, normalizeProductionRate(body));
  } catch (error) {
    return pricebookError(c, error);
  }
});

ratesApp.put('/:id', pricebookAccess, async (c) => {
  try {
    productionPricebookOperationKey(c.req.header('Idempotency-Key'));
    const id = z.string().uuid().parse(c.req.param('id'));
    const body = rateFields.partial().parse(await c.req.json().catch(() => null));
    const db = createDb(c.env.DATABASE_URL);
    const existing = await db.query.productionRates.findFirst({
      where: and(eq(productionRates.id, id), eq(productionRates.orgId, c.get('orgId'))),
    });
    if (!existing) return c.json({ error: 'Production rate not found.' }, 404);
    return await mutatePricebook(
      c,
      'update',
      { id, ...body },
      normalizeProductionRate(body, existing),
      id,
      body.expectedVersion ?? existing.version,
    );
  } catch (error) {
    return pricebookError(c, error);
  }
});

ratesApp.delete('/:id', pricebookAccess, async (c) => {
  try {
    productionPricebookOperationKey(c.req.header('Idempotency-Key'));
    const id = z.string().uuid().parse(c.req.param('id'));
    return await mutatePricebook(c, 'delete', { id }, null, id);
  } catch (error) {
    return pricebookError(c, error);
  }
});

// Read-only preview: price/rate/tax inputs are resolved from this tenant's active pricebook.
ratesApp.post(
  '/calculate',
  requireOrgPermission(['manage_estimates'], 'Ask an owner for permission to preview estimate costs.'),
  async (c) => {
    const orgId = c.get('orgId');
    const db = createDb(c.env.DATABASE_URL);
    try {
      productionPricebookOperationKey(c.req.header('Idempotency-Key'));
      const preview = await resolveProductionEstimation(db, orgId, await c.req.json().catch(() => null));
      const resultMap = new Map(preview.calculation.items.map((item) => [item.id, item]));
      const rateMap = new Map(preview.rates.map((rate) => [rate.id, rate]));
      const items = preview.productionInput.items.map((item) => {
        const line = resultMap.get(item.id)!;
        const rate = rateMap.get(item.productionRateId)!;
        return {
          ...item,
          hours: Number(line.hours).toFixed(2),
          laborCost: formatEstimationMinor(line.laborMinor),
          materialCost: formatEstimationMinor(line.materialCostMinor),
          materialPrice: formatEstimationMinor(line.materialMinor),
          rateName: `${rate.category} (${rate.surfaceType})`,
        };
      });
      return c.json({
        data: {
          resolvedInput: preview.resolvedInput,
          calculation: preview.calculation,
          items,
          // Keep the legacy labor-only total while exposing the complete versioned calculation.
          total: formatEstimationMinor(preview.calculation.totals.laborMinor),
          subtotal: formatEstimationMinor(preview.calculation.totals.subtotalMinor),
          tax: formatEstimationMinor(preview.calculation.totals.taxMinor),
          grandTotal: formatEstimationMinor(preview.calculation.totals.totalMinor),
        },
      });
    } catch (error) {
      if (error instanceof PricebookOperationError) return pricebookError(c, error);
      if (!(error instanceof EstimationInputError)) throw error;
      return c.json(
        { error: error.message, code: error.code, fieldErrors: productionEstimationFieldErrors(error) },
        400,
      );
    }
  },
);

export default ratesApp;
