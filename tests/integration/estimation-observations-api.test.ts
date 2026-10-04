import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import app from '../../apps/api/src/routes/estimation-observations.ts';
import changeOrdersRoute from '../../apps/api/src/routes/change-orders.ts';
import { calculateProductionEstimate } from '../../packages/core/src/estimation.ts';
import { buildAcceptedEstimationBudget } from '../../packages/core/src/estimation-budget.ts';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db.ts';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const orgA = randomUUID(), orgB = randomUUID(), ownerA = randomUUID(), ownerB = randomUUID(), crewA = randomUUID();
const kv = new Map<string, string>();
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_pe1718_test', ENVIRONMENT: 'test',
  KV: { get: async (key: string) => kv.get(key) || null } };
const conditions = 'Synthetic drywall; normal access';

async function call(path: string, body?: unknown, token = 'owner-a', key = randomUUID()) {
  const response = await app.fetch(new Request(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env as never);
  return response;
}
async function data(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return (await response.json() as any).data;
}

before(async () => {
  await migrateDisposableDatabase(pool);
  // Parent owns journal registration. Standalone tests also exercise the exact
  // additive migrations if that registration has not landed in the shared tree.
  const journal = JSON.parse(await readFile(new URL('../../packages/db/migrations/meta/_journal.json', import.meta.url), 'utf8'));
  for (const tag of ['0033_estimation_pricebook_v2', '0034_accepted_estimation_handoff', '0035_estimation_observations']) {
    if (journal.entries.some((entry: { tag: string }) => entry.tag === tag)) continue;
    let source: string;
    try { source = await readFile(new URL(`../../packages/db/migrations/${tag}.sql`, import.meta.url), 'utf8'); }
    catch (error) {
      if (tag !== '0034_accepted_estimation_handoff') throw error;
      const { readdir } = await import('node:fs/promises');
      const names = await readdir(new URL('../../packages/db/migrations/', import.meta.url));
      const name = names.find((entry) => entry.startsWith('0034_'));
      if (!name) throw error;
      if (journal.entries.some((entry: { tag: string }) => `${entry.tag}.sql` === name)) continue;
      source = await readFile(new URL(`../../packages/db/migrations/${name}`, import.meta.url), 'utf8');
    }
    for (const statement of source.split('--> statement-breakpoint')) if (statement.trim()) await pool.query(statement);
  }
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2),($3,$4,$4)', [orgA, `pe17-${orgA}`, orgB, `pe17-${orgB}`]);
  await pool.query('insert into users(id,email) values($1,$2),($3,$4),($5,$6)', [ownerA, `${ownerA}@example.invalid`, ownerB, `${ownerB}@example.invalid`, crewA, `${crewA}@example.invalid`]);
  await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner'),($1,$5,'member')", [orgA, ownerA, orgB, ownerB, crewA]);
  for (const [token, orgId, userId] of [['owner-a', orgA, ownerA], ['owner-b', orgB, ownerB], ['crew-a', orgA, crewA]]) {
    kv.set(`session:${token}`, JSON.stringify({ orgId, userId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  }
});
after(async () => { restore(); await pool.end(); });

async function fixture(orgId = orgA, options: { missingCost?: boolean; flagged?: boolean; undated?: boolean; missingChangeBudget?: boolean } = {}) {
  const leadId = (await pool.query("insert into leads(org_id,name) values($1,'Synthetic client') returning id", [orgId])).rows[0].id;
  const rateId = (await pool.query("insert into production_rates(org_id,category,surface_type,unit,coats,rate_basis,coat_rates,application_method,rate_per_hour,hourly_rate,burdened_rate) values($1,'walls','synthetic drywall','sqft',2,'complete_system',$2,'brush_roll',80,50,30) returning id", [orgId, JSON.stringify({ '2': '80' })])).rows[0].id;
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [{ id: 'walls', quantity: '768', unit: 'sqft', coats: 2,
    labor: { productionRatePerHour: '80', sellingRate: '50', burdenedRate: options.missingCost ? undefined : '30', rateBasis: 'complete_system',
      coatRates: { '2': '80' }, applicationMethod: 'brush_roll', rateVersion: '1', productionRateId: rateId },
    material: { productId: 'synthetic-paint', colorCode: 'WHITE', coverageBasis: 'per_gallon', coveragePerGallon: '400',
      coverageUnit: 'sqft', packSizeGallons: '1', costPerPack: '40' } }] });
  const pkg = { name: 'proposal', total: '640', calculationVersion: 'repaint-v2', calculationSnapshot: calculation };
  const estimateId = (await pool.query("insert into estimates(org_id,lead_id,status,total,packages,signed_at) values($1,$2,'accepted',640,$3,now()) returning id", [orgId, leadId, JSON.stringify([pkg])])).rows[0].id;
  const budget = buildAcceptedEstimationBudget(estimateId, pkg, [], '2026-10-01T12:00:00Z');
  const jobId = (await pool.query("insert into jobs(org_id,lead_id,estimate_id,status,name,estimation_budget) values($1,$2,$3,'completed','Synthetic repaint',$4) returning id", [orgId, leadId, estimateId, JSON.stringify(budget)])).rows[0].id;
  const member = (await pool.query("insert into team_members(org_id,name,role,hourly_rate) values($1,'Synthetic painter','painter',30) returning id", [orgId])).rows[0].id;
  const timeId = (await pool.query("insert into time_entries(org_id,job_id,team_member_id,hours,total_cost,date,hourly_rate,review_status) values($1,$2,$3,12,360,'2026-10-02',30,$4) returning id", [orgId, jobId, member, options.flagged ? 'flagged' : 'approved'])).rows[0].id;
  await pool.query("insert into job_costs(org_id,job_id,category,description,quantity,unit_cost,total_cost,cost_date) values($1,$2,'labor','Synthetic labor',12,30,360,'2026-10-02')", [orgId, jobId]);
  const purchaseId = (await pool.query("insert into material_purchases(org_id,job_id,supplier,invoice_date,total_amount,parsed_data) values($1,$2,'Synthetic supplier',$3,200,$4) returning id", [orgId, jobId, options.undated ? null : '2026-10-02', JSON.stringify([{ gallons: '5' }])])).rows[0].id;
  const costId = (await pool.query("insert into job_costs(org_id,job_id,category,description,quantity,unit_cost,total_cost,cost_date,material_purchase_id) values($1,$2,'materials','Synthetic paint',5,40,200,'2026-10-02',$3) returning id", [orgId, jobId, purchaseId])).rows[0].id;
  if (options.missingChangeBudget) await pool.query("insert into change_orders(org_id,job_id,estimate_id,status,amount,description,created_by) values($1,$2,$3,'approved',100,'Synthetic added scope','contractor')", [orgId, jobId, estimateId]);
  return { jobId, timeId, estimateId, rateId, costId, budget };
}
async function attribute(f: Awaited<ReturnType<typeof fixture>>, token = 'owner-a', key?: string) {
  const current = await data(await call(`/jobs/${f.jobId}`, undefined, token));
  return call(`/jobs/${f.jobId}/attributions`, { expectedRevision: current.comparison.revision, timeEntryId: f.timeId, operationId: 'walls:application' }, token, key);
}
async function close(f: Awaited<ReturnType<typeof fixture>>, token = 'owner-a') {
  await data(await attribute(f, token));
  const current = await data(await call(`/jobs/${f.jobId}`, undefined, token));
  await data(await call(`/jobs/${f.jobId}/closeout`, { expectedRevision: current.comparison.revision, costsComplete: true, conditions }, token));
  return data(await call(`/jobs/${f.jobId}`, undefined, token));
}
function previewBody(f: Awaited<ReturnType<typeof fixture>>, comparisonConditions = conditions) {
  return { rateId: f.rateId, expectedVersion: 1, kind: 'application', conditions: comparisonConditions };
}
async function createApprovedChange(f: Awaited<ReturnType<typeof fixture>>, token = 'owner-a', status = 'approved') {
  const response = await changeOrdersRoute.fetch(new Request('http://localhost/', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ jobId: f.jobId, estimateId: f.estimateId, description: 'Actual route extra walls', amount: 100, status,
      scopeDetails: { items: [], estimationBudget: { unsupported: 'must not be trusted' } }, createdBy: 'contractor' }) }), env as never);
  return data(response);
}
function changeBudgetBody(expectedRevision: string) {
  return { expectedRevision, laborHours: '3.5', laborCost: '105', materialCost: '40', otherCost: '0',
    theoreticalGallons: '1', orderGallons: '2', provenance: 'Owner-reviewed extra wall takeoff and burdened labor/material worksheet.' };
}

test('real DB route compares accepted budget with approved hours and dated ledger once', async () => {
  const f = await fixture();
  const result = await data(await call(`/jobs/${f.jobId}`));
  assert.equal(result.comparison.budgetHours, '9.6');
  assert.equal(result.comparison.approvedHours, '12');
  assert.equal(result.comparison.recordedActualCostMinor, 56000);
  assert.equal(result.comparison.purchasedVarianceGallons, '1.16');
  assert.equal(result.comparison.wasteGallons, null);
  assert.equal(result.comparison.unattributedApprovedTime.length, 1);
});

test('approved CO scope budget adds once; foreign child costs and tenant headers never disclose private prices', async () => {
  const f = await fixture();
  const other = await fixture(orgB);
  const changeBudget = structuredClone(f.budget);
  changeBudget.calculation!.items[0].id = 'added-walls';
  changeBudget.operationIds = ['added-walls'];
  await pool.query("insert into change_orders(org_id,job_id,estimate_id,status,amount,description,created_by,scope_details) values($1,$2,$3,'approved',100,'Synthetic extra scope','contractor',$4)",
    [orgA, f.jobId, f.estimateId, JSON.stringify({ estimationBudget: changeBudget })]);
  await pool.query("insert into job_costs(org_id,job_id,category,description,quantity,unit_cost,total_cost,cost_date) values($1,$2,'materials','Foreign private costs',1,999,999,'2026-10-02')", [orgB, f.jobId]);
  await pool.query("insert into material_purchases(org_id,job_id,supplier,total_amount,invoice_date) values($1,$2,'Foreign supplier',999,'2026-10-02')", [orgB, f.jobId]);
  const view = await data(await call(`/jobs/${f.jobId}`));
  assert.equal(view.comparison.budgetHours, '19.2');
  assert.equal(view.comparison.budgetDirectCostMinor, 89600);
  assert.equal(view.comparison.recordedActualCostMinor, 56000);
  assert.equal(view.comparison.purchases.length, 1);
  assert.equal((await call(`/jobs/${f.jobId}`, undefined, 'crew-a')).status, 403);
  const spoof = await app.fetch(new Request(`http://localhost/jobs/${other.jobId}`, { headers: { Authorization: 'Bearer owner-a', 'x-org-id': orgB } }), env as never);
  assert.equal(spoof.status, 404);
  await assert.rejects(pool.query('insert into estimation_time_attributions(org_id,job_id,time_entry_id,operation_id,reviewed_by) values($1,$2,$3,$4,$5)',
    [orgA, f.jobId, other.timeId, 'walls:application', ownerA]), /foreign key/);
});

test('real CO creation followed by reviewed delta capture persists once and never rewrites agreement price/scope', async () => {
  const f = await fixture();
  const change = await createApprovedChange(f);
  assert.equal(change.scopeDetails.estimationBudget, undefined); // The existing creation DTO strips this field.
  const before = (await pool.query('select to_jsonb(co) as agreement from change_orders co where id=$1', [change.id])).rows[0].agreement;
  const initial = await data(await call(`/jobs/${f.jobId}`));
  assert.ok(initial.comparison.missingChangeBudgetIds.includes(change.id));
  const body = changeBudgetBody(initial.comparison.revision);
  const key = randomUUID();
  const path = `/jobs/${f.jobId}/change-orders/${change.id}/budget`;
  for (const response of await Promise.all(Array.from({ length: 4 }, () => call(path, body, 'owner-a', key)))) await data(response);
  const current = await data(await call(`/jobs/${f.jobId}`));
  assert.deepEqual(current.comparison.missingChangeBudgetIds, []);
  assert.equal(current.comparison.budgetHours, '13.1');
  assert.equal(current.comparison.budgetDirectCostMinor, 59300);
  assert.equal(current.comparison.theoreticalGallons, '4.84');
  assert.equal(current.comparison.orderBudgetGallons, '6');
  assert.equal(current.comparison.recordedActualCostMinor, 56000);
  assert.equal((await pool.query('select count(*) from estimation_change_budgets where org_id=$1 and change_order_id=$2', [orgA, change.id])).rows[0].count, '1');
  assert.deepEqual((await pool.query('select to_jsonb(co) as agreement from change_orders co where id=$1', [change.id])).rows[0].agreement, before);
  assert.deepEqual((await pool.query('select estimation_budget from jobs where id=$1', [f.jobId])).rows[0].estimation_budget, JSON.parse(JSON.stringify(f.budget)));
  assert.equal((await call(path, { ...body, expectedRevision: current.comparison.revision })).status, 409);
  assert.equal((await call(path, { ...body, laborCost: '106' }, 'owner-a', key)).status, 409);
  await assert.rejects(pool.query("update estimation_change_budgets set budget='{}'::jsonb where change_order_id=$1", [change.id]), /immutable/);
  await assert.rejects(pool.query('delete from estimation_change_budgets where change_order_id=$1', [change.id]), /immutable/);
  await data(await attribute(f));
  const reviewedSource = await data(await call(`/jobs/${f.jobId}`));
  await data(await call(`/jobs/${f.jobId}/closeout`, { expectedRevision: reviewedSource.comparison.revision, costsComplete: true, conditions }));
  const closeout = await data(await call(`/jobs/${f.jobId}`));
  assert.equal(closeout.observations[0].qualified, false);
  assert.ok(closeout.observations[0].exclusions.some((reason: string) => reason.includes('measured task quantities')));
});

test('real delta capture preserves explicit unknown costs and rejects stale, unapproved, foreign and crew writes', async () => {
  const f = await fixture();
  const approved = await createApprovedChange(f);
  const pendingChange = await createApprovedChange(f, 'owner-a', 'pending');
  const foreign = await fixture(orgB);
  const foreignChange = await createApprovedChange(foreign, 'owner-b');
  const foreignView = await data(await call(`/jobs/${foreign.jobId}`, undefined, 'owner-b'));
  await data(await call(`/jobs/${foreign.jobId}/change-orders/${foreignChange.id}/budget`, changeBudgetBody(foreignView.comparison.revision), 'owner-b'));
  const view = await data(await call(`/jobs/${f.jobId}`));
  const body = changeBudgetBody(view.comparison.revision);
  const path = `/jobs/${f.jobId}/change-orders/${approved.id}/budget`;
  assert.equal((await call(path, body, 'crew-a')).status, 403);
  assert.equal((await call(path, body, 'owner-a', '')).status, 400);
  assert.equal((await call(path, { ...body, expectedRevision: '0'.repeat(32) })).status, 409);
  assert.equal((await call(`/jobs/${f.jobId}/change-orders/${pendingChange.id}/budget`, body)).status, 404);
  assert.equal((await call(`/jobs/${f.jobId}/change-orders/${foreignChange.id}/budget`, body)).status, 404);
  assert.equal((await call(path, { ...body, materialCost: '-1' })).status, 400);
  assert.equal((await call(path, { ...body, laborCost: '0.001' })).status, 400);
  await data(await call(path, { ...body, laborCost: null, materialCost: null, theoreticalGallons: null }));
  const after = await data(await call(`/jobs/${f.jobId}`));
  assert.equal(after.comparison.budgetHours, '13.1');
  assert.equal(after.comparison.budgetDirectCostMinor, null);
  assert.equal(after.comparison.budgetMaterialMinor, null);
  assert.equal(after.comparison.theoreticalGallons, null);
  assert.equal(after.comparison.reviewedChangeBudgets[0].laborCostMinor, null);
});

test('tenant B jobs/time/rates/observations and proposals cannot be resolved by A', async () => {
  const f = await fixture(orgB);
  const result = await close(f, 'owner-b');
  assert.equal(result.observations.length, 1);
  assert.equal((await call(`/jobs/${f.jobId}`)).status, 404);
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, { expectedRevision: result.comparison.revision, timeEntryId: f.timeId, operationId: 'walls:application' })).status, 404);
  assert.equal((await call('/rates/preview', previewBody(f))).status, 404);
  const proposal = await data(await call('/rates/preview', previewBody(f), 'owner-b'));
  assert.equal((await call(`/rates/${proposal.id}/apply`, { approve: true })).status, 404);
  const own = await fixture();
  const view = await data(await call(`/jobs/${own.jobId}`));
  assert.ok(!view.observations.some((observation: any) => observation.jobId === f.jobId));
  assert.ok(!view.rates.some((rate: any) => rate.id === f.rateId));
});

test('owner-only mutations, required keys, strict payloads and task/time tenancy fail closed', async () => {
  const f = await fixture();
  const foreign = await fixture(orgB);
  const view = await data(await call(`/jobs/${f.jobId}`));
  const body = { expectedRevision: view.comparison.revision, timeEntryId: f.timeId, operationId: 'walls:application' };
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, body, 'crew-a')).status, 403);
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, body, 'owner-a', '')).status, 400);
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, { ...body, timeEntryId: foreign.timeId })).status, 404);
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, { ...body, operationId: 'foreign:application' })).status, 400);
  assert.equal((await call('/rates/preview', { ...previewBody(f), suggestedRate: '999' })).status, 400);
  assert.equal((await call(`/jobs/${f.jobId}/closeout`, { expectedRevision: view.comparison.revision, costsComplete: false, conditions })).status, 400);
});

test('concurrent attribution and closeout retries have one durable outcome and reject key reuse', async () => {
  const f = await fixture();
  const original = await data(await call(`/jobs/${f.jobId}`));
  const key = randomUUID();
  const body = { expectedRevision: original.comparison.revision, timeEntryId: f.timeId, operationId: 'walls:application' };
  const calls = await Promise.all(Array.from({ length: 4 }, () => call(`/jobs/${f.jobId}/attributions`, body, 'owner-a', key)));
  for (const response of calls) await data(response);
  assert.equal((await pool.query('select count(*) from estimation_time_attributions where org_id=$1 and job_id=$2', [orgA, f.jobId])).rows[0].count, '1');
  assert.equal((await call(`/jobs/${f.jobId}/attributions`, { ...body, operationId: 'other' }, 'owner-a', key)).status, 409);
  const current = await data(await call(`/jobs/${f.jobId}`));
  const closeBody = { expectedRevision: current.comparison.revision, costsComplete: true, conditions };
  const reviewKey = randomUUID();
  for (const response of await Promise.all(Array.from({ length: 4 }, () => call(`/jobs/${f.jobId}/closeout`, closeBody, 'owner-a', reviewKey)))) await data(response);
  assert.equal((await pool.query('select count(*) from estimation_observations where org_id=$1 and job_id=$2', [orgA, f.jobId])).rows[0].count, '1');
});

test('qualified preview is server-recalculated; explicit approval appends a rate version without repricing contracts', async () => {
  const f = await fixture();
  await close(f);
  const before = (await pool.query('select packages,total from estimates where id=$1', [f.estimateId])).rows[0];
  const key = randomUUID();
  const proposal = await data(await call('/rates/preview', previewBody(f), 'owner-a', key));
  assert.equal(proposal.suggestion.suggestedRate, '64'); // 768 / 12, no coat multiplier.
  assert.ok(proposal.suggestion.sampleCount >= 1);
  assert.equal((await data(await call('/rates/preview', previewBody(f), 'owner-a', key))).id, proposal.id);
  assert.equal((await pool.query('select is_active,version,coat_rates from production_rates where id=$1', [f.rateId])).rows[0].is_active, true);
  assert.equal((await call(`/rates/${proposal.id}/apply`, { approve: false })).status, 400);
  const applyKey = randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => call(`/rates/${proposal.id}/apply`, { approve: true }, 'owner-a', applyKey)));
  const versions = await Promise.all(results.map((response) => data(response)));
  assert.equal(new Set(versions.map((version) => version.appliedRateId)).size, 1);
  const next = (await pool.query('select * from production_rates where id=$1', [versions[0].appliedRateId])).rows[0];
  assert.equal(next.version, 2);
  assert.equal(next.coat_rates['2'], '64');
  assert.equal(next.hourly_rate, '50.00');
  assert.equal(next.burdened_rate, '30.00');
  assert.equal((await pool.query('select is_active from production_rates where id=$1', [f.rateId])).rows[0].is_active, false);
  assert.deepEqual((await pool.query('select packages,total from estimates where id=$1', [f.estimateId])).rows[0], before);
  assert.deepEqual((await pool.query('select estimation_budget from jobs where id=$1', [f.jobId])).rows[0].estimation_budget, JSON.parse(JSON.stringify(f.budget)));
});

test('stale closeout revision, changed source costs and changed pricebook prevent approval', async () => {
  const f = await fixture();
  const view = await close(f);
  const proposal = await data(await call('/rates/preview', previewBody(f)));
  await pool.query('update job_costs set total_cost=201 where id=$1', [f.costId]);
  assert.equal((await call(`/jobs/${f.jobId}/closeout`, { expectedRevision: view.comparison.revision, costsComplete: true, conditions })).status, 409);
  assert.equal((await call(`/rates/${proposal.id}/apply`, { approve: true })).status, 409);
  const changed = await data(await call(`/jobs/${f.jobId}`));
  assert.equal(changed.observations[0].qualified, false);
  const f2 = await fixture();
  await close(f2);
  const p2 = await data(await call('/rates/preview', previewBody(f2)));
  await pool.query('update production_rates set version=2 where id=$1', [f2.rateId]);
  assert.equal((await call(`/rates/${p2.id}/apply`, { approve: true })).status, 409);
});

test('missing cost/change budgets and undated purchases are recorded as exclusions, not training data', async () => {
  for (const option of [{ missingCost: true }, { missingChangeBudget: true }, { undated: true }]) {
    const f = await fixture(orgA, option);
    const view = await close(f);
    assert.equal(view.observations[0].qualified, false);
    assert.ok(view.observations[0].exclusions.length > 0);
  }
  const flagged = await fixture(orgA, { flagged: true });
  assert.equal((await attribute(flagged)).status, 404);
  const f = await fixture();
  assert.equal((await call('/rates/preview', previewBody(f, 'Unseen conditions'))).status, 400);
});

test('unrelated rate lineage or mismatched method cannot consume a qualified job sample', async () => {
  const f = await fixture();
  await close(f);
  const unrelated = await fixture();
  assert.equal((await call('/rates/preview', previewBody(unrelated))).status, 400);
  await pool.query("update production_rates set application_method='spray_only' where id=$1", [f.rateId]);
  assert.equal((await call('/rates/preview', previewBody(f))).status, 400);
});

test('new tables enforce RLS for two tenants under an unprivileged database role', async () => {
  const role = `pe17_${randomUUID().replaceAll('-', '')}`;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`create role ${role} nologin`);
    await client.query(`grant usage on schema public to ${role}`);
    await client.query(`grant select,insert on estimation_observations,estimation_time_attributions,estimation_rate_versions,estimation_change_budgets to ${role}`);
    await client.query(`set local role ${role}`);
    await client.query("select set_config('app.current_org_id',$1,true)", [orgA]);
    for (const table of ['estimation_observations', 'estimation_time_attributions', 'estimation_rate_versions', 'estimation_change_budgets']) {
      assert.equal((await client.query(`select count(*) from ${table} where org_id=$1`, [orgB])).rows[0].count, '0');
    }
    await assert.rejects(client.query('insert into estimation_observations(org_id,job_id,operation_id,evidence_revision,observation,reviewed_by) values($1,$2,$3,$4,$5,$6)',
      [orgB, randomUUID(), 'spoof', 'x', '{}', ownerA]), /row-level security/);
  } finally { await client.query('rollback'); client.release(); }
});
