import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { estimateTemplates } from '@crewmodo/db/schema';
import { eq, and, desc, or, sql, type SQL } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { requireOrgPermission } from '../middleware/financial-access';
import { productionCalculationSchema } from '../lib/production-estimation';
import { decimal } from '../../../../packages/core/src/estimation-decimal';
import {
  assertEstimationTemplateCompatible,
  estimationTemplateWarnings,
  validateEstimationTemplateScope,
  ESTIMATION_TEMPLATE_ASSEMBLY_FORMAT,
  type EstimationTemplateScope,
} from '../../../../packages/core/src/estimation-template';
import { camelRecord } from '../lib/supplier-operations';

const templatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
templatesApp.use('*', authMiddleware);
templatesApp.use(
  '*',
  requireOrgPermission(['manage_estimates'], 'Ask an owner for permission to view estimate template costs.'),
);

function templateDecimal(positive = false) {
  return z.union([z.number().finite(), z.string().trim().max(32)]).superRefine((value, ctx) => {
    try {
      decimal(value, 'quantity', { scale: 8, positive });
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Enter a valid decimal.',
      });
    }
  });
}
const provenanceSchema = z
  .object({
    source: z.string().max(120).optional(),
    sourceId: z.string().max(150).optional(),
    version: z.string().max(100).optional(),
    effectiveAt: z.string().max(40).optional(),
    priceDate: z.string().max(40).optional(),
    coverageSource: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
const rateBasisSchema = z.enum(['legacy_per_coat', 'complete_system', 'hours_per_item']);
const importBasisSchema = z
  .object({
    format: z.string().trim().min(1).max(120).optional(),
    rateBasis: rateBasisSchema.optional(),
    coverageBasis: z.enum(['per_coat', 'complete_system']).optional(),
    source: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
const calculationItemSchema = productionCalculationSchema.shape.items.element;
const operationSchema = calculationItemSchema.shape.operations
  .unwrap()
  .element.extend({ provenance: provenanceSchema.optional() })
  .strict();
const layerSchema = calculationItemSchema.shape.coatingLayers
  .unwrap()
  .element.extend({ provenance: provenanceSchema.optional() })
  .strict();
const metadata = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= 100_000, 'Measurement metadata is too large.');

const templateSubstrateSchema = calculationItemSchema
  .extend({
    category: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().max(255).optional(),
    productionRateId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    unit: z.enum(['sqft', 'linear_ft', 'each']).optional(),
    quantity: templateDecimal().optional(),
    width: templateDecimal().optional(),
    height: templateDecimal().optional(),
    coatingWidthInches: templateDecimal(true).optional(),
    coatingSqFtPerItem: templateDecimal(true).optional(),
    coats: z.number().int().min(1).max(3).optional(),
    prepLevel: z.enum(['none', 'light', 'standard', 'heavy']).optional(),
    applicationMethod: z.enum(['brush_roll', 'spray_backroll', 'spray_only']).optional(),
    customerVisible: z.boolean().optional(),
    optional: z.boolean().optional(),
    colorName: z.string().trim().max(120).optional(),
    colorCode: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(500).optional(),
    operations: z.array(operationSchema).min(1).max(20).optional(),
    coatingLayers: z.array(layerSchema).max(4).optional(),
    measurement: metadata.optional(),
    geometryKind: z
      .enum(['walls', 'ceilings', 'trim', 'doors', 'exterior_body', 'soffit', 'fascia', 'corner_boards'])
      .optional(),
    rateBasis: rateBasisSchema.optional(),
    importBasis: importBasisSchema.optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict()
  .refine((item) => Boolean(item.category || item.label || item.productionRateId), 'Select a substrate.');

const nativeAssemblySchema = z
  .object({
    format: z.literal(ESTIMATION_TEMPLATE_ASSEMBLY_FORMAT),
    calculationVersion: z.literal('repaint-v2'),
    materialSellingPolicy: z.enum(['purchase', 'consumption']).optional(),
    minimumPrice: templateDecimal().optional(),
    mobilizationHours: templateDecimal().optional(),
    discount: templateDecimal().optional(),
    adjustments: z
      .array(
        productionCalculationSchema.shape.adjustments
          .unwrap()
          .element.extend({
            description: z.string().trim().max(500).optional(),
            category: z.string().trim().max(120).optional(),
            provenance: provenanceSchema.optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

const templateFields = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    category: z.enum(['room', 'full_estimate', 'package']).default('room'),
    isShared: z.boolean().default(false),
    isSmart: z.boolean().default(false),
    rooms: z
      .array(
        z
          .object({
            name: z.string(),
            roomType: z.string().optional(),
            id: z.string().trim().min(1).max(150).optional(),
            length: templateDecimal(true).optional(),
            width: templateDecimal(true).optional(),
            kind: z.enum(['interior', 'exterior', 'custom']).optional(),
            metrics: metadata.optional(),
            surfaces: z.array(templateSubstrateSchema).max(500).optional(),
            items: z.array(templateSubstrateSchema).max(500).optional(),
          })
          .strict(),
      )
      .max(200),
    packages: z.array(nativeAssemblySchema).max(1).optional(),
  })
  .strict();

export const templateSchema = templateFields.superRefine((value, ctx) => {
  try {
    validateEstimationTemplateScope(value as unknown as EstimationTemplateScope);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'This template cannot be preserved safely.',
    });
  }
});

export function templateInterchange(template: EstimationTemplateScope) {
  try {
    const checked = templateSchema.safeParse({
      name: 'Interchange scope',
      rooms: template.rooms,
      packages: template.packages ?? undefined,
    });
    if (!checked.success)
      throw new Error(
        checked.error.issues[0]?.message || 'This template contains unsupported scope or pricing fields.',
      );
    const { assembly, warnings } = assertEstimationTemplateCompatible(template, 'production');
    return {
      productionCompatible: true,
      calculationVersion: assembly?.calculationVersion ?? 'repaint-v1',
      warnings,
    };
  } catch (error) {
    let warnings: string[] = [];
    try {
      warnings = estimationTemplateWarnings(template);
    } catch {
      /* A malformed legacy row must not break the catalog. */
    }
    return {
      productionCompatible: false,
      warnings,
      error: error instanceof Error ? error.message : 'This template cannot be applied safely.',
    };
  }
}

function templateResponse<T extends { rooms: unknown; packages?: unknown }>(template: T) {
  const scope = {
    rooms: template.rooms,
    packages: template.packages,
  } as EstimationTemplateScope;
  return { ...template, interchange: templateInterchange(scope) };
}

type TemplateContext = Context<{ Bindings: Env; Variables: Variables }>;
class TemplateOperationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
    readonly code: string,
  ) {
    super(message);
  }
}
function templateOperationKey(c: TemplateContext) {
  const key = c.req.header('Idempotency-Key')?.trim();
  if (!key || key.length > 200)
    throw new TemplateOperationError('A valid Idempotency-Key is required.', 400, 'INVALID_OPERATION_KEY');
  return key;
}
async function savedTemplateOperation(
  db: ReturnType<typeof createDb>,
  c: TemplateContext,
  action: string,
  key: string,
  request: string,
) {
  const result =
    await db.execute(sql`select request=${request}::jsonb as matches,result from operation_results
    where org_id=${c.get('orgId')}::uuid and action=${action} and actor=${c.get('userId')} and operation_key=${key}`);
  const row = result.rows[0] as
    | { matches: boolean; result: { template: Record<string, unknown> } }
    | undefined;
  if (row && !row.matches)
    throw new TemplateOperationError(
      'This key was already used for different template details.',
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  return row ? { ...row.result, replayed: true } : null;
}
async function mutateTemplate(
  db: ReturnType<typeof createDb>,
  c: TemplateContext,
  action: string,
  key: string,
  request: string,
  mutation: SQL,
) {
  const previous = await savedTemplateOperation(db, c, action, key, request);
  if (previous) return previous;
  try {
    // The unique operation result and scope mutation commit in one statement. A
    // concurrent duplicate rolls back its mutation before replaying the winner.
    const result = await db.execute(sql`with changed as (${mutation}), recorded as (
      insert into operation_results(org_id,action,actor,operation_key,request,result)
      select ${c.get('orgId')}::uuid,${action},${c.get('userId')},${key},${request}::jsonb,
        jsonb_build_object('template',to_jsonb(changed)) from changed returning result
    ) select result from recorded`);
    return result.rows[0]
      ? { ...(result.rows[0].result as { template: Record<string, unknown> }), replayed: false }
      : null;
  } catch (error) {
    let conflict = error as { code?: string; constraint?: string; cause?: unknown };
    for (let depth = 0; !conflict.code && conflict.cause && depth < 3; depth++)
      conflict = conflict.cause as typeof conflict;
    if (conflict.code !== '23505' || conflict.constraint !== 'operation_results_pkey') throw error;
    const replay = await savedTemplateOperation(db, c, action, key, request);
    if (!replay) throw error;
    return replay;
  }
}
function templateOperationResponse(
  c: TemplateContext,
  result: { template: Record<string, unknown>; replayed: boolean },
  created = false,
) {
  const template = camelRecord<typeof estimateTemplates.$inferSelect>(result.template);
  for (const field of ['createdAt', 'updatedAt'] as const) {
    const value = template[field];
    if (typeof value === 'string')
      template[field] = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  }
  return c.json(
    { data: templateResponse(template), replayed: result.replayed },
    created && !result.replayed ? 201 : 200,
  );
}
function templateOperationError(c: TemplateContext, error: unknown) {
  if (error instanceof TemplateOperationError)
    return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}

const BUILTIN_TEMPLATES = [
  {
    name: 'Interior Repaint - Whole Home Starter',
    description:
      'Reasonable starter scope for a small-to-mid interior repaint with rooms, walls, ceilings, trim, and doors.',
    category: 'full_estimate',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Bedroom 1',
        roomType: 'bedroom',
        kind: 'interior',
        length: 12,
        width: 12,
        metrics: { length: 12, width: 12, perimeter: 48, height: 9, windows: 1, doors: 1 },
        surfaces: [
          {
            category: 'walls',
            label: 'Walls',
            quantity: 390,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'ceilings',
            label: 'Ceiling',
            width: 12,
            height: 12,
            coats: 1,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Trim',
            quantity: 78,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'doors',
            label: 'Doors',
            quantity: 1,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
      {
        name: 'Bedroom 2',
        roomType: 'bedroom',
        kind: 'interior',
        length: 11,
        width: 11,
        metrics: { length: 11, width: 11, perimeter: 44, height: 9, windows: 1, doors: 1 },
        surfaces: [
          {
            category: 'walls',
            label: 'Walls',
            quantity: 350,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'ceilings',
            label: 'Ceiling',
            width: 11,
            height: 11,
            coats: 1,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Trim',
            quantity: 72,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'doors',
            label: 'Doors',
            quantity: 1,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
      {
        name: 'Living room',
        roomType: 'living_room',
        kind: 'interior',
        length: 18,
        width: 16,
        metrics: { length: 18, width: 16, perimeter: 68, height: 9, windows: 2, doors: 1 },
        surfaces: [
          {
            category: 'walls',
            label: 'Walls',
            quantity: 540,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'ceilings',
            label: 'Ceiling',
            width: 18,
            height: 16,
            coats: 1,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Trim',
            quantity: 118,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
      {
        name: 'Kitchen',
        roomType: 'kitchen',
        kind: 'interior',
        length: 14,
        width: 12,
        metrics: { length: 14, width: 12, perimeter: 52, height: 9, windows: 1, doors: 1 },
        surfaces: [
          {
            category: 'walls',
            label: 'Walls',
            quantity: 330,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'ceilings',
            label: 'Ceiling',
            width: 14,
            height: 12,
            coats: 1,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Trim',
            quantity: 85,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
      {
        name: 'Hallway',
        roomType: 'hallway',
        kind: 'interior',
        length: 14,
        width: 4,
        metrics: { length: 14, width: 4, perimeter: 36, height: 9, windows: 0, doors: 2 },
        surfaces: [
          {
            category: 'walls',
            label: 'Walls',
            quantity: 275,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'ceilings',
            label: 'Ceiling',
            width: 14,
            height: 4,
            coats: 1,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Trim',
            quantity: 75,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'doors',
            label: 'Doors',
            quantity: 2,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
    ],
  },
  {
    name: 'Exterior Repaint - Two Story Starter',
    description:
      'Reasonable starter scope for a two-story exterior repaint with siding, soffits, fascia, trim, and corner boards.',
    category: 'full_estimate',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Exterior',
        roomType: 'exterior',
        kind: 'exterior',
        metrics: { perimeter: 160, height: 20, windows: 14, doors: 3, corners: 4 },
        surfaces: [
          {
            category: 'exterior_body',
            label: 'Siding',
            quantity: 2850,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'spray_backroll',
          },
          {
            category: 'soffit',
            label: 'Soffits',
            quantity: 352,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'fascia',
            label: 'Fascia',
            quantity: 176,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'trim',
            label: 'Window and door trim',
            quantity: 278,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
          {
            category: 'corner_boards',
            label: 'Corner boards',
            quantity: 80,
            coats: 2,
            prepLevel: 'standard',
            applicationMethod: 'brush_roll',
          },
        ],
      },
    ],
  },
  {
    name: 'Master Bedroom',
    description: '4 walls, ceiling, trim',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Master Bedroom',
        roomType: 'bedroom',
        length: 15,
        width: 12,
        items: [
          { category: 'walls', quantity: 480, prepLevel: 'standard' },
          { category: 'ceiling', quantity: 180, prepLevel: 'standard' },
          { category: 'trim', quantity: 60, prepLevel: 'standard' },
        ],
      },
    ],
  },
  {
    name: 'Kitchen',
    description: 'Walls, ceiling, cabinets',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Kitchen',
        roomType: 'kitchen',
        length: 15,
        width: 10,
        items: [
          { category: 'walls', quantity: 400, prepLevel: 'standard' },
          { category: 'ceiling', quantity: 150, prepLevel: 'standard' },
          { category: 'cabinets', quantity: 20, prepLevel: 'heavy' },
        ],
      },
    ],
  },
  {
    name: 'Living Room',
    description: '4 walls, ceiling, trim',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Living Room',
        roomType: 'living_room',
        length: 20,
        width: 12,
        items: [
          { category: 'walls', quantity: 560, prepLevel: 'standard' },
          { category: 'ceiling', quantity: 240, prepLevel: 'standard' },
          { category: 'trim', quantity: 72, prepLevel: 'standard' },
        ],
      },
    ],
  },
  {
    name: 'Bathroom',
    description: 'Small room with moisture resistance',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [
      {
        name: 'Bathroom',
        roomType: 'bathroom',
        length: 10,
        width: 6,
        items: [
          { category: 'walls', quantity: 280, prepLevel: 'heavy' },
          { category: 'ceiling', quantity: 60, prepLevel: 'standard' },
          { category: 'trim', quantity: 40, prepLevel: 'standard' },
        ],
      },
    ],
  },
];

templatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const db = createDb(c.env.DATABASE_URL);

  let templates = await db.query.estimateTemplates.findMany({
    where: and(
      eq(estimateTemplates.orgId, orgId),
      or(eq(estimateTemplates.isShared, true), eq(estimateTemplates.createdBy, userId)),
    ),
    orderBy: [desc(estimateTemplates.usageCount)],
  });

  if (templates.length === 0) {
    const seeded = await db
      .insert(estimateTemplates)
      .values(BUILTIN_TEMPLATES.map((t) => ({ orgId, createdBy: userId, ...t })))
      .returning();
    templates = seeded;
  }

  return c.json({ data: templates.map(templateResponse) });
});

templatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const result = templateSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { error: 'This template cannot be preserved safely.', details: result.error.flatten() },
      400,
    );
  const parsed = result.data;
  const db = createDb(c.env.DATABASE_URL);

  try {
    const key = templateOperationKey(c);
    const result = await mutateTemplate(
      db,
      c,
      'estimate_template.create',
      key,
      JSON.stringify(body),
      sql`
      insert into estimate_templates(org_id,created_by,name,description,category,is_shared,is_smart,rooms,packages)
      values(${orgId}::uuid,${userId}::uuid,${parsed.name},${parsed.description ?? null},${parsed.category},
        ${parsed.isShared},${parsed.isSmart},${JSON.stringify(parsed.rooms)}::jsonb,${parsed.packages ? JSON.stringify(parsed.packages) : null}::jsonb)
      returning *`,
    );
    return templateOperationResponse(c, result!, true);
  } catch (error) {
    return templateOperationError(c, error);
  }
});

templatesApp.post('/:id/use', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  let key: string;
  const request = JSON.stringify({ id });
  try {
    key = templateOperationKey(c);
    const replay = await savedTemplateOperation(db, c, 'estimate_template.use', key, request);
    if (replay) return templateOperationResponse(c, replay);
  } catch (error) {
    return templateOperationError(c, error);
  }

  const template = await db.query.estimateTemplates.findFirst({
    where: and(
      eq(estimateTemplates.id, id),
      eq(estimateTemplates.orgId, orgId),
      or(eq(estimateTemplates.isShared, true), eq(estimateTemplates.createdBy, userId)),
    ),
  });

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }
  const response = templateResponse(template);
  if (!response.interchange.productionCompatible) {
    return c.json(
      {
        error: response.interchange.error,
        code: 'INCOMPATIBLE_TEMPLATE',
        warnings: response.interchange.warnings,
      },
      409,
    );
  }

  try {
    const result = await mutateTemplate(
      db,
      c,
      'estimate_template.use',
      key,
      request,
      sql`
      update estimate_templates set usage_count=usage_count+1 where id=${id}::uuid and org_id=${orgId}::uuid
        and (is_shared=true or created_by=${userId}::uuid) and date_trunc('milliseconds',updated_at)=${template.updatedAt.toISOString()}::timestamp and rooms=${JSON.stringify(template.rooms)}::jsonb
        and packages is not distinct from ${template.packages ? JSON.stringify(template.packages) : null}::jsonb returning *`,
    );
    if (!result)
      return c.json(
        { error: 'This template changed. Reload it before applying.', code: 'STALE_TEMPLATE' },
        409,
      );
    return templateOperationResponse(c, result);
  } catch (error) {
    return templateOperationError(c, error);
  }
});

templatesApp.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const patch = templateFields.partial().safeParse(body);
  if (!patch.success)
    return c.json(
      { error: 'This template cannot be preserved safely.', details: patch.error.flatten() },
      400,
    );
  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.estimateTemplates.findFirst({
    where: and(eq(estimateTemplates.id, id), eq(estimateTemplates.orgId, orgId)),
  });
  if (!existing) return c.json({ error: 'Template not found' }, 404);
  const merged = templateSchema.safeParse({
    name: existing.name,
    description: existing.description ?? undefined,
    category: existing.category,
    isShared: existing.isShared,
    isSmart: existing.isSmart,
    rooms: existing.rooms,
    packages: existing.packages ?? undefined,
    ...patch.data,
  });
  if (!merged.success)
    return c.json(
      { error: 'This template cannot be preserved safely.', details: merged.error.flatten() },
      400,
    );

  const [template] = await db
    .update(estimateTemplates)
    .set({ ...patch.data, updatedAt: new Date() })
    .where(and(eq(estimateTemplates.id, id), eq(estimateTemplates.orgId, orgId)))
    .returning();

  return c.json({ data: templateResponse(template) });
});

templatesApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  await db
    .delete(estimateTemplates)
    .where(and(eq(estimateTemplates.id, id), eq(estimateTemplates.orgId, orgId)));

  return c.json({ success: true });
});

export default templatesApp;
