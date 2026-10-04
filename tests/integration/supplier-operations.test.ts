import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required. Use a disposable local database ending in _test.');
const url = new URL(connectionString);
const host = url.searchParams.get('host') || url.hostname;
if (!['localhost', '127.0.0.1', '/var/run/postgresql'].includes(host) || !url.pathname.endsWith('_test')) {
  throw new Error('Integration tests refuse remote or non-test databases.');
}
if (process.env.CREWMODO_RESET_TEST_DB !== '1') throw new Error('Set CREWMODO_RESET_TEST_DB=1 to reset this disposable database.');
const pool = new pg.Pool({ connectionString, max: 12 });
const orgA = randomUUID();
const orgB = randomUUID();
const actor = randomUUID();
let jobA: string;
let jobB: string;

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const journal = JSON.parse(await readFile(new URL('../../packages/db/migrations/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) {
    const contents = await readFile(new URL(`../../packages/db/migrations/${entry.tag}.sql`, import.meta.url), 'utf8');
    for (const statement of contents.split('--> statement-breakpoint')) {
      if (statement.trim()) await pool.query(statement);
    }
  }
  await pool.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $2), ($3, $4, $4)', [orgA, `tenant-a-${orgA}`, orgB, `tenant-b-${orgB}`]);
  await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [actor, `test-${actor}@example.invalid`]);
  for (const [org, name] of [[orgA, 'A'], [orgB, 'B']]) {
    const lead = (await pool.query('INSERT INTO leads (org_id, name) VALUES ($1, $2) RETURNING id', [org, name])).rows[0].id;
    const job = (await pool.query('INSERT INTO jobs (org_id, lead_id, name) VALUES ($1, $2, $3) RETURNING id', [org, lead, `Job ${name}`])).rows[0].id;
    if (org === orgA) jobA = job; else jobB = job;
  }
});
after(async () => { await pool.end(); });

async function stage(org = orgA, hash = randomUUID().replaceAll('-', '').repeat(2), items?: unknown[]) {
  const lines = items || [{ description: 'Duration Satin', sku: 'sw-duration', quantity: 2, unitCost: 50, gallons: 2, pricePerGallon: 50, total: 100 }];
  const payload = {
    documentHash: hash, sourceType: 'upload', supplier: 'Sherwin-Williams', invoiceNumber: randomUUID(),
    invoiceDate: '2026-03-10T00:00:00.000Z', rawText: 'Synthetic test invoice',
    extractedItems: lines,
    extractedData: {}, matchCandidates: [], matchConfidence: 0, extractionConfidence: 0.9,
    totalAmount: lines.reduce<number>((sum, line) => sum + Number((line as { total: number }).total), 0).toFixed(2),
  };
  const result = (await pool.query('SELECT stage_supplier_import($1, $2, $3) AS result', [org, payload, actor])).rows[0].result;
  return result.import;
}
function approve(id: string, job = jobA, key = randomUUID(), org = orgA, apply = true) {
  return pool.query('SELECT approve_supplier_import($1,$2,$3,$4,$5,$6,$7,$8) AS result',
    [org, id, job, apply, 'Reviewed', actor, key, { importId: id, jobId: job, applyMaterialUpdates: apply, reviewNotes: 'Reviewed' }]);
}

test('concurrent approval makes one purchase, cost, history row and preserves transaction date', async () => {
  const invoice = await stage();
  const key = randomUUID();
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => approve(invoice.id, jobA, key)));
  assert.equal(new Set(outcomes.map((row) => row.rows[0].result.purchase.id)).size, 1);
  assert.equal((await pool.query('SELECT count(*) FROM job_costs WHERE material_purchase_id = $1', [outcomes[0].rows[0].result.purchase.id])).rows[0].count, '1');
  assert.equal((await pool.query('SELECT count(*) FROM material_price_history WHERE import_id = $1', [invoice.id])).rows[0].count, '1');
  const cost = (await pool.query("SELECT to_char(cost_date, 'YYYY-MM-DD') AS date FROM job_costs WHERE material_purchase_id = $1", [outcomes[0].rows[0].result.purchase.id])).rows[0];
  assert.equal(cost.date, '2026-03-10');
});

test('changed payload under the same key conflicts, and a new key cannot duplicate an approved source', async () => {
  const invoice = await stage();
  const key = randomUUID();
  await approve(invoice.id, jobA, key);
  await assert.rejects(approve(invoice.id, jobA, key, orgA, false), { code: 'P0409' });
  const again = (await approve(invoice.id)).rows[0].result;
  assert.equal(again.replayed, true);
});

test('cross-tenant approval and job assignment reveal no purchase and write nothing', async () => {
  const invoice = await stage();
  await assert.rejects(approve(invoice.id, jobB), { code: 'P0404' });
  await assert.rejects(approve(invoice.id, jobB, randomUUID(), orgB), { code: 'P0404' });
  assert.equal((await pool.query('SELECT status FROM supplier_invoice_imports WHERE id = $1', [invoice.id])).rows[0].status, 'needs_review');
});

test('failure on a later line rolls the entire approval back', async () => {
  const invoice = await stage(orgA, undefined, [
    { description: 'Valid first line', quantity: 1, unitCost: 10, total: 10 },
    { description: 'Invalid second line', quantity: 'not-a-number', unitCost: 10, total: 10 },
  ]);
  await assert.rejects(approve(invoice.id));
  assert.equal((await pool.query('SELECT status FROM supplier_invoice_imports WHERE id = $1', [invoice.id])).rows[0].status, 'needs_review');
  assert.equal((await pool.query('SELECT count(*) FROM material_purchases WHERE document_hash = $1', [invoice.document_hash])).rows[0].count, '0');
});

test('purchase totals reconcile and similar invoice numbers require a deliberate confirmation', async () => {
  const invoice = await stage();
  await pool.query("UPDATE supplier_invoice_imports SET total_amount = 99 WHERE id = $1", [invoice.id]);
  await assert.rejects(approve(invoice.id), { code: 'P0409' });
  await pool.query("UPDATE supplier_invoice_imports SET total_amount=100, extracted_data=$2 WHERE id=$1", [invoice.id, { possibleDuplicatePurchaseId: randomUUID() }]);
  await assert.rejects(approve(invoice.id), { code: 'P0409' });
  const result = await pool.query('SELECT approve_supplier_import($1,$2,$3,true,null,$4,$5,$6) AS result',
    [orgA, invoice.id, jobA, actor, randomUUID(), { importId: invoice.id, jobId: jobA, confirmSimilarPurchase: true }]);
  assert.equal(result.rows[0].result.import.status, 'approved');
});

test('five-gallon pricing preserves pack coverage and late older invoices cannot overwrite newer costs', async () => {
  const sku = `bucket-${randomUUID()}`;
  const material = (await pool.query("INSERT INTO materials (org_id,name,category,unit,cost_per_unit,supplier,sku,coverage_sq_ft) VALUES ($1,'Five-gallon paint','paint','5 gallon',250,'Sherwin-Williams',$2,2000) RETURNING id", [orgA, sku])).rows[0];
  const invoice = await stage(orgA, undefined, [{ description: 'Bucket', size: '5 GAL', sku, quantity: 1, unitCost: 300, gallons: 5, pricePerGallon: 60, total: 300 }]);
  await approve(invoice.id);
  const current = (await pool.query('SELECT unit,cost_per_unit,coverage_sq_ft FROM materials WHERE id=$1', [material.id])).rows[0];
  assert.equal(current.unit, '5 gallon');
  assert.equal(current.cost_per_unit, '300.00');
  assert.equal(current.coverage_sq_ft, '2000.00');
  const older = await stage(orgA, undefined, [{ description: 'Old bucket', size: '5 GAL', sku, quantity: 1, unitCost: 200, gallons: 5, pricePerGallon: 40, total: 200 }]);
  await pool.query("UPDATE supplier_invoice_imports SET invoice_date='2026-01-01' WHERE id=$1", [older.id]);
  await approve(older.id);
  assert.equal((await pool.query('SELECT cost_per_unit FROM materials WHERE id=$1', [material.id])).rows[0].cost_per_unit, '300.00');
});

test('byte-distinct copies staged before approval require a live duplicate confirmation', async () => {
  const first = await stage();
  const second = await stage();
  await pool.query('UPDATE supplier_invoice_imports SET invoice_number=$2, supplier=$3 WHERE id=$1', [second.id, first.invoice_number, ' sherwin-williams ']);
  await approve(first.id);
  await assert.rejects(approve(second.id), { code: 'P0409' });
  assert.equal((await pool.query('SELECT status FROM supplier_invoice_imports WHERE id=$1', [second.id])).rows[0].status, 'needs_review');
  const confirmed = await pool.query('SELECT approve_supplier_import($1,$2,$3,false,null,$4,$5,$6) AS result',
    [orgA, second.id, jobA, actor, randomUUID(), { importId: second.id, jobId: jobA, confirmSimilarPurchase: true }]);
  assert.equal(confirmed.rows[0].result.import.status, 'approved');
});

test('unreconciled original charges cannot be approved and untrusted per-gallon metadata cannot inflate pack prices', async () => {
  const missingFee = await stage();
  await pool.query('UPDATE supplier_invoice_imports SET extracted_data=$2 WHERE id=$1', [missingFee.id, { documentReconciliation: { required: true, status: 'mismatch', documentTotal: '102.90', lineTotal: '100.00' } }]);
  await assert.rejects(approve(missingFee.id), { code: 'P0409' });
  const sku = `safe-pack-${randomUUID()}`;
  const material = (await pool.query("INSERT INTO materials (org_id,name,category,unit,cost_per_unit,supplier,sku) VALUES ($1,'Safe pack','paint','5 gallon',250,'Sherwin-Williams',$2) RETURNING id", [orgA, sku])).rows[0];
  const corrupt = await stage(orgA, undefined, [{ description: 'Bucket', size: '5 GAL', sku, quantity: 1, unitCost: 300, gallons: 5, pricePerGallon: 300, total: 300 }]);
  await approve(corrupt.id);
  assert.equal((await pool.query('SELECT cost_per_unit FROM materials WHERE id=$1', [material.id])).rows[0].cost_per_unit, '300.00');
});

test('staging concurrent identical files creates one import, but identical other-tenant files are independent', async () => {
  const hash = randomUUID().replaceAll('-', '').repeat(2);
  const results = await Promise.all(Array.from({ length: 8 }, () => stage(orgA, hash)));
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.notEqual((await stage(orgB, hash)).id, results[0].id);
});

function reserve(hash: string, budget = '1', token = randomUUID(), org = orgB) {
  return pool.query('SELECT reserve_supplier_ocr($1,$2,$3,$4,$5,$6,$7,$8) AS result', [org, hash, token, '0.50', 100, 100, 100, budget]);
}

test('concurrent same-file OCR attempts reserve exactly once', async () => {
  const hash = randomUUID().replaceAll('-', '').repeat(2);
  const results = await Promise.all(Array.from({ length: 8 }, () => reserve(hash, '100')));
  assert.equal(results.filter((row) => row.rows[0].result.state === 'reserved').length, 1);
  assert.equal(results.filter((row) => row.rows[0].result.state === 'processing').length, 7);
});

test('concurrent distinct OCR attempts cannot exceed reserved monthly spend', async () => {
  const org = randomUUID();
  await pool.query('INSERT INTO organizations (id, name, slug) VALUES ($1,$2,$2)', [org, `budget-${org}`]);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(randomUUID().replaceAll('-', '').repeat(2), '1', randomUUID(), org)));
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 2);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'P0429');
});

test('expired ambiguous OCR is not automatically retried or released', async () => {
  const hash = randomUUID().replaceAll('-', '').repeat(2);
  await reserve(hash, '100');
  await pool.query("UPDATE supplier_document_claims SET updated_at = now() - interval '10 minutes' WHERE org_id = $1 AND document_hash = $2", [orgB, hash]);
  assert.equal((await reserve(hash, '100')).rows[0].result.state, 'unknown');
});

test('new tables enforce RLS for a non-owner tenant role', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE crewmodo_isolation_test NOLOGIN');
    await client.query('GRANT USAGE ON SCHEMA public TO crewmodo_isolation_test');
    await client.query('GRANT SELECT ON supplier_document_claims, operation_results, material_price_history TO crewmodo_isolation_test');
    await client.query('SET LOCAL ROLE crewmodo_isolation_test');
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
    for (const table of ['supplier_document_claims', 'operation_results', 'material_price_history']) {
      assert.equal((await client.query(`SELECT count(*) FROM ${table} WHERE org_id <> $1`, [orgA])).rows[0].count, '0');
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
