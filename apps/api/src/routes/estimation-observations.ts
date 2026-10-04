import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb, type DbClient } from '@crewmodo/db';
import { memberships, productionRates } from '@crewmodo/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { EstimationInputError } from '../../../../packages/core/src/estimation';
import { decimal, decimalText, minor } from '../../../../packages/core/src/estimation-decimal';
import {
  compareJobEstimationBudget, reviewEstimationCloseout, suggestEstimationRate,
  type JobEstimationEvidence, type EstimationObservation, type ComparableRate, type EstimationRateSuggestion,
} from '../../../../packages/core/src/estimation-observations';
import { authMiddleware } from '../middleware/tenant';
import { financialAccess } from '../middleware/financial-access';
import { camelRecord, supplierCall, SupplierOperationError } from '../lib/supplier-operations';
import { actionEvent } from '../lib/action-telemetry';
import type { Env, Variables } from '../types';

// Parent mounts this additive router at /v1/estimation-observations.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
app.use('*', authMiddleware, financialAccess);
app.onError((error, c) => {
  if (error instanceof z.ZodError || error instanceof EstimationInputError) return c.json({ error: error.message }, 400);
  if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: 'ESTIMATION_OBSERVATION_CONFLICT' }, error.status);
  console.error('Estimation observation request failed');
  return c.json({ error: 'Could not complete the closeout request.' }, 500);
});

const uuid = z.string().uuid();
const revision = z.string().regex(/^[a-f0-9]{32}$/);
const attribution = z.object({ expectedRevision: revision, timeEntryId: uuid, operationId: z.string().min(1).max(500) }).strict();
const closeout = z.object({ expectedRevision: revision, costsComplete: z.literal(true), conditions: z.string().trim().min(1).max(500) }).strict();
const preview = z.object({ rateId: uuid, expectedVersion: z.number().int().positive(),
  kind: z.enum(['application', 'primer', 'prep', 'setup', 'masking', 'cut_in', 'cleanup', 'mobilization', 'other']),
  conditions: z.string().trim().min(1).max(500) }).strict();
const approve = z.object({ approve: z.literal(true) }).strict();
const manualAmount = z.union([z.string().min(1).max(32), z.number().finite().nonnegative()]).nullable();
const changeBudget = z.object({ expectedRevision: revision, laborHours: manualAmount, laborCost: manualAmount,
  materialCost: manualAmount, otherCost: manualAmount, theoreticalGallons: manualAmount, orderGallons: manualAmount,
  provenance: z.string().trim().min(5).max(1000) }).strict();

async function isOwner(db: DbClient, c: Ctx) {
  const membership = await db.query.memberships.findFirst({ where: and(eq(memberships.orgId, c.get('orgId')), eq(memberships.userId, c.get('userId'))) });
  return membership?.role === 'owner';
}

async function evidence(db: DbClient, org: string, job: string) {
  const result = await supplierCall<JobEstimationEvidence | null>(db, sql`select estimation_job_evidence(${org}::uuid,${job}::uuid) as result`);
  if (!result) throw new SupplierOperationError('Job not found.', 404, 'JOB_NOT_FOUND');
  return result;
}

async function observations(db: DbClient, org: string, job?: string): Promise<EstimationObservation[]> {
  const result = await db.execute(sql`with sources as materialized (
    select job_id,estimation_job_evidence(${org}::uuid,job_id)->>'revision' as revision from (
      select distinct job_id from estimation_observations where org_id=${org}::uuid ${job ? sql`and job_id=${job}::uuid` : sql``}
    ) jobs
  ) select o.id,o.observation,o.evidence_revision=s.revision as current
    from estimation_observations o join sources s on s.job_id=o.job_id
    where o.org_id=${org}::uuid ${job ? sql`and o.job_id=${job}::uuid` : sql``}
    order by o.reviewed_at desc,o.id`);
  return (result.rows as unknown as Array<{ id: string; observation: EstimationObservation; current: boolean }>).map((row) => ({
    ...row.observation, id: row.id, qualified: row.current && row.observation.qualified,
    exclusions: [...row.observation.exclusions, ...(!row.current ? ['Source evidence changed after closeout review.'] : [])],
  }));
}

async function mutate(db: DbClient, c: Ctx, action: string, request: unknown, payload: unknown, job?: string, expected?: string) {
  return supplierCall<{ proposal?: Record<string, unknown>; replayed: boolean; jobId?: string }>(db,
    sql`select mutate_estimation_observations(${c.get('orgId')}::uuid,${c.get('userId')}::uuid,
      ${c.req.header('Idempotency-Key')},${action},${JSON.stringify(request)}::jsonb,
      ${job || null}::uuid,${expected || null},${JSON.stringify(payload)}::jsonb) as result`);
}

async function replay(db: DbClient, c: Ctx, action: string, request: unknown) {
  const results = await db.execute(sql`select request=${JSON.stringify(request)}::jsonb as matches,result
    from operation_results where org_id=${c.get('orgId')}::uuid and actor=${c.get('userId')}
    and action=${`estimation.${action}`} and operation_key=${c.req.header('Idempotency-Key')}`);
  const row = results.rows[0] as { matches: boolean; result: Record<string, unknown> } | undefined;
  if (row && !row.matches) throw new SupplierOperationError('This operation key was used for different details.', 409, 'KEY_REUSED');
  return row ? { ...row.result, replayed: true } : null;
}

function response(c: Ctx, result: { proposal?: Record<string, unknown>; replayed?: unknown }, action: string) {
  if (!result.replayed && c.env.POSTHOG_ENABLED === 'true' && c.env.POSTHOG_PROJECT_TOKEN) {
    // Reuse opaque actor/tenant identities; only the milestone name is different.
    const pending = actionEvent({ action: 'estimate.saved', orgId: c.get('orgId'), actorId: c.get('userId'),
      entityId: String(result.proposal?.id || c.req.path), occurredAt: new Date().toISOString() }).then(async (event) => {
      const host = c.env.POSTHOG_HOST || 'https://us.i.posthog.com';
      if (!['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host)) return;
      await fetch(`${host}/i/v0/e/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, event: `estimation.${action}`, api_key: c.env.POSTHOG_PROJECT_TOKEN }), signal: AbortSignal.timeout(3000) });
    }).catch(() => undefined);
    try { c.executionCtx.waitUntil(pending); } catch { void pending; }
  }
  return c.json({ data: result.proposal ? camelRecord(result.proposal) : result, replayed: !!result.replayed });
}

app.use('*', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const key = c.req.header('Idempotency-Key');
  if (!key?.trim() || key.length > 200) return c.json({ error: 'An Idempotency-Key of 1-200 characters is required.' }, 400);
  if (!await isOwner(createDb(c.env.DATABASE_URL), c)) return c.json({ error: 'Only an owner can review closeout or approve rate versions.' }, 403);
  await next();
});

app.get('/jobs/:jobId', async (c) => {
  const job = uuid.parse(c.req.param('jobId'));
  const db = createDb(c.env.DATABASE_URL);
  const source = await evidence(db, c.get('orgId'), job);
  const canReview = await isOwner(db, c);
  const rates = canReview ? await db.query.productionRates.findMany({ where: and(eq(productionRates.orgId, c.get('orgId')), eq(productionRates.isActive, true)) }) : [];
  return c.json({ data: { comparison: compareJobEstimationBudget(source, new Date().toISOString()),
    observations: await observations(db, c.get('orgId'), job), canReview,
    rates: rates.map((rate) => ({ id: rate.id, category: rate.category, surfaceType: rate.surfaceType, version: rate.version,
      unit: rate.unit, coats: rate.coats, rateBasis: rate.rateBasis, applicationMethod: rate.applicationMethod })) } });
});

app.post('/jobs/:jobId/attributions', async (c) => {
  const job = uuid.parse(c.req.param('jobId'));
  const body = attribution.parse(await c.req.json().catch(() => null));
  const request = { ...body, jobId: job };
  const db = createDb(c.env.DATABASE_URL);
  const prior = await replay(db, c, 'attribute', request);
  if (prior) return response(c, prior, 'attribute');
  const source = await evidence(db, c.get('orgId'), job);
  const comparison = compareJobEstimationBudget(source, new Date().toISOString());
  if (!comparison.operations.some((operation) => operation.id === body.operationId)) throw new SupplierOperationError('Select a task in the accepted budget.', 400, 'TASK_NOT_FOUND');
  return response(c, await mutate(db, c, 'attribute', request, body, job, body.expectedRevision), 'attribute');
});

app.post('/jobs/:jobId/closeout', async (c) => {
  const job = uuid.parse(c.req.param('jobId'));
  const body = closeout.parse(await c.req.json().catch(() => null));
  const request = { ...body, jobId: job };
  const db = createDb(c.env.DATABASE_URL);
  const prior = await replay(db, c, 'review', request);
  if (prior) return response(c, prior, 'review');
  const source = await evidence(db, c.get('orgId'), job);
  const reviewed = reviewEstimationCloseout(source, { costsComplete: body.costsComplete!, conditions: body.conditions! }, new Date().toISOString());
  if (!reviewed.length) throw new SupplierOperationError('There are no identified operating tasks to review.', 400, 'NO_TASKS');
  return response(c, await mutate(db, c, 'review', request, { observations: reviewed }, job, body.expectedRevision), 'review');
});

// Existing CO creation stores customer scope/price only. This explicit reviewed
// budget capture is a separate financial operation, never a signed-price edit.
app.post('/jobs/:jobId/change-orders/:changeOrderId/budget', async (c) => {
  const job = uuid.parse(c.req.param('jobId'));
  const changeOrderId = uuid.parse(c.req.param('changeOrderId'));
  const body = changeBudget.parse(await c.req.json().catch(() => null));
  const request = { ...body, jobId: job, changeOrderId };
  const db = createDb(c.env.DATABASE_URL);
  const prior = await replay(db, c, 'change-budget', request);
  if (prior) return response(c, prior, 'change-budget');
  const source = await evidence(db, c.get('orgId'), job);
  if (!source.changes.some((change) => change.id === changeOrderId && ['approved', 'completed'].includes(change.status))) {
    throw new SupplierOperationError('Select an approved change order from this job.', 404, 'CHANGE_NOT_FOUND');
  }
  const quantity = (value: string | number | null, field: string) => value === null ? null : decimalText(decimal(value, field, { scale: 6 }), 6);
  const cost = (value: string | number | null, field: string) => value === null ? null : minor(decimal(value, field, { scale: 2 }), field);
  const budget = { version: 'reviewed-change-budget-v1', changeOrderId, laborHours: quantity(body.laborHours!, 'laborHours'),
    laborCostMinor: cost(body.laborCost!, 'laborCost'), materialCostMinor: cost(body.materialCost!, 'materialCost'),
    otherCostMinor: cost(body.otherCost!, 'otherCost'), theoreticalGallons: quantity(body.theoreticalGallons!, 'theoreticalGallons'),
    orderGallons: quantity(body.orderGallons!, 'orderGallons'), provenance: body.provenance,
    reviewedBy: c.get('userId'), reviewedAt: new Date().toISOString() };
  return response(c, await mutate(db, c, 'change-budget', request, budget, job, body.expectedRevision), 'change-budget');
});

async function calculateSuggestion(db: DbClient, org: string, body: z.infer<typeof preview>) {
  const rate = await db.query.productionRates.findFirst({ where: and(eq(productionRates.orgId, org), eq(productionRates.id, body.rateId), eq(productionRates.isActive, true)) });
  if (!rate) throw new SupplierOperationError('Rate not found.', 404, 'RATE_NOT_FOUND');
  if (rate.version !== body.expectedVersion) throw new SupplierOperationError('The pricebook changed. Preview the current version.', 409, 'STALE_RATE');
  // Legacy prep correction would otherwise be trained into the production rate twice.
  if (!rate.applicationMethod || !['sqft', 'linear_ft', 'each'].includes(rate.unit)
    || !['legacy_per_coat', 'complete_system', 'hours_per_item'].includes(rate.rateBasis)
    || (rate.rateBasis === 'legacy_per_coat' && Number(rate.prepMultiplier) !== 1)) {
    throw new SupplierOperationError('This rate lacks a comparable method/basis or has a legacy prep multiplier.', 400, 'INCOMPARABLE_RATE');
  }
  const target: ComparableRate = { unit: rate.unit as ComparableRate['unit'], coats: rate.coats,
    rateBasis: rate.rateBasis as ComparableRate['rateBasis'], method: rate.applicationMethod, kind: body.kind, conditions: body.conditions };
  const ancestry = await db.execute(sql`with recursive lineage(id) as (
    select ${rate.id}::uuid union select v.source_rate_id from estimation_rate_versions v
    join lineage l on v.applied_rate_id=l.id where v.org_id=${org}::uuid and v.status='applied'
  ) select id from lineage`);
  const sourceIds = new Set(ancestry.rows.map((row) => String(row.id)));
  const samples = (await observations(db, org)).map((observation) => sourceIds.has(observation.sourceRateId || '') ? observation : {
    ...observation, qualified: false, exclusions: [...observation.exclusions, 'Different production rate lineage.'],
  });
  const suggestion = suggestEstimationRate(samples, target);
  if (!suggestion.suggestedRate || Number(suggestion.suggestedRate) <= 0 || Number(suggestion.suggestedRate) > 99999999.99) {
    throw new SupplierOperationError('No qualified comparable closeouts support a rate suggestion.', 400, 'NO_SAMPLES');
  }
  return suggestion;
}

app.post('/rates/preview', async (c) => {
  const body = preview.parse(await c.req.json().catch(() => null));
  const db = createDb(c.env.DATABASE_URL);
  const prior = await replay(db, c, 'preview', body);
  if (prior) return response(c, prior, 'preview');
  const suggestion = await calculateSuggestion(db, c.get('orgId'), body);
  return response(c, await mutate(db, c, 'preview', body, { ...body, suggestion }), 'preview');
});

app.post('/rates/:proposalId/apply', async (c) => {
  const proposalId = uuid.parse(c.req.param('proposalId'));
  const body = approve.parse(await c.req.json().catch(() => null));
  const request = { ...body, proposalId };
  const db = createDb(c.env.DATABASE_URL);
  const prior = await replay(db, c, 'apply', request);
  if (prior) return response(c, prior, 'apply');
  const rows = await db.execute(sql`select source_rate_id,source_version,suggestion,status from estimation_rate_versions
    where org_id=${c.get('orgId')}::uuid and id=${proposalId}::uuid`);
  const proposal = rows.rows[0] as { source_rate_id: string; source_version: number; suggestion: EstimationRateSuggestion; status: string } | undefined;
  if (!proposal) throw new SupplierOperationError('Rate preview not found.', 404, 'PREVIEW_NOT_FOUND');
  let suggestion = proposal.suggestion;
  if (proposal.status !== 'applied') {
    try {
      suggestion = await calculateSuggestion(db, c.get('orgId'), {
        rateId: proposal.source_rate_id, expectedVersion: proposal.source_version,
        kind: proposal.suggestion.kind as z.infer<typeof preview>['kind'], conditions: proposal.suggestion.conditions,
      });
    } catch (error) {
      // Another request may have committed this exact approval after our first read.
      const replayed = await replay(db, c, 'apply', request);
      if (replayed) return response(c, replayed, 'apply');
      const latest = await db.execute(sql`select status from estimation_rate_versions
        where org_id=${c.get('orgId')}::uuid and id=${proposalId}::uuid`);
      if (latest.rows[0]?.status !== 'applied') {
        if (error instanceof SupplierOperationError && [400, 404].includes(error.status)) {
          throw new SupplierOperationError('Closeout or pricebook evidence changed. Review and preview again.', 409, 'STALE_PREVIEW');
        }
        throw error;
      }
    }
  }
  return response(c, await mutate(db, c, 'apply', request, { proposalId, suggestion }), 'apply');
});

export default app;
