import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import invoices from '../../apps/api/src/routes/invoices';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restoreBridge = bridgeNeonToPostgres(pool);
const orgA = randomUUID();
const orgB = randomUUID();
const owner = randomUUID();
const crew = randomUUID();
let job: string;
const kv = new Map<string, string>();
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_api_test',
  ENVIRONMENT: 'test',
  KV: { get: async (key: string) => kv.get(key) || null, delete: async (key: string) => { kv.delete(key); } },
};
function request(path: string, token = 'owner', method = 'GET', body?: unknown, key = randomUUID()) {
  return invoices.fetch(new Request(`http://localhost${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env as never);
}

before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('INSERT INTO organizations (id, name, slug) VALUES ($1,$2,$2),($3,$4,$4)', [orgA, `api-a-${orgA}`, orgB, `api-b-${orgB}`]);
  await pool.query('INSERT INTO users (id, email) VALUES ($1,$2),($3,$4)', [owner, `${owner}@example.invalid`, crew, `${crew}@example.invalid`]);
  await pool.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')", [orgA, owner, crew]);
  const plan = (await pool.query("INSERT INTO saas_plans (name,price,features) VALUES ('pro',149,'{}') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO subscriptions (org_id,plan_id,status,current_period_end) VALUES ($1,$2,'active',now()+interval '1 month')", [orgA, plan]);
  const lead = (await pool.query('INSERT INTO leads (org_id,name) VALUES ($1,$2) RETURNING id', [orgA, 'Synthetic client'])).rows[0].id;
  job = (await pool.query('INSERT INTO jobs (org_id,lead_id,name) VALUES ($1,$2,$3) RETURNING id', [orgA, lead, 'Synthetic repaint'])).rows[0].id;
  for (const [token, userId, orgId] of [['owner', owner, orgA], ['crew', crew, orgA], ['other', owner, orgB]]) {
    kv.set(`session:${token}`, JSON.stringify({ userId, orgId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  }
});
after(async () => { restoreBridge(); await pool.end(); });

test('authentication and financial permission fail closed, including legacy import bypass', async () => {
  assert.equal((await request('/imports', 'unknown')).status, 401);
  assert.equal((await request('/imports', 'crew')).status, 403);
  assert.equal((await request('/imports', 'other')).status, 403);
  assert.equal((await request('/upload', 'owner', 'POST', {})).status, 410);
});

test('a job-cost reviewer can read supplier imports but cannot read customer invoices', async () => {
  const roleId = randomUUID();
  await pool.query('INSERT INTO roles(id,org_id,name,permissions) VALUES ($1,$2,$3,$4)',
    [roleId, orgA, 'Cost reviewer', JSON.stringify(['manage_job_costs'])]);
  await pool.query('INSERT INTO user_roles(org_id,user_id,role_id) VALUES ($1,$2,$3)', [orgA, crew, roleId]);
  try {
    assert.equal((await request('/imports', 'crew')).status, 200);
    assert.equal((await request('/customer', 'crew')).status, 403);
  } finally {
    await pool.query('DELETE FROM user_roles WHERE org_id=$1 AND user_id=$2', [orgA, crew]);
    await pool.query('DELETE FROM roles WHERE id=$1', [roleId]);
  }
});

test('real HTTP/Drizzle approval stores once, requires a job, and preserves its transaction date', async () => {
  const staged = await request('/imports', 'owner', 'POST', {
    sourceType: 'upload', supplier: 'Sherwin-Williams', invoiceNumber: randomUUID(), invoiceDate: '2026-03-10',
    rawText: 'Duration Paint ABC123 2 50.00 100.00',
  });
  assert.equal(staged.status, 201, await staged.clone().text());
  const { data } = await staged.json() as { data: { id: string } };
  assert.equal((await request(`/imports/${data.id}/approve`, 'owner', 'POST', {})).status, 400);
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 6 }, () => request(`/imports/${data.id}/approve`, 'owner', 'POST', { jobId: job }, key)));
  for (const result of results) assert.equal(result.status, 200, await result.clone().text());
  const purchaseIds = await Promise.all(results.map(async (result) => (await result.json() as any).data.purchase.id));
  assert.equal(new Set(purchaseIds).size, 1);
  const costs = await pool.query("SELECT total_cost, to_char(cost_date,'YYYY-MM-DD') AS date FROM job_costs WHERE material_purchase_id=$1", [purchaseIds[0]]);
  assert.equal(costs.rows.length, 1);
  assert.equal(costs.rows[0].total_cost, '100.00');
  assert.equal(costs.rows[0].date, '2026-03-10');
  assert.equal((await request(`/imports/${data.id}/approve`, 'owner', 'POST', { jobId: job, applyMaterialUpdates: false }, key)).status, 409);
  assert.equal((await request(`/imports/${data.id}/file`, 'crew')).status, 403);
  assert.equal((await request(`/imports/${data.id}/file`, 'owner')).status, 404);
});

test('foreign-tenant imports are not visible or approvable even to another owner', async () => {
  const foreign = (await pool.query("INSERT INTO supplier_invoice_imports (org_id,source_type,status,raw_text,extracted_items,total_amount) VALUES ($1,'upload','needs_review','private','[]',0) RETURNING id", [orgB])).rows[0].id;
  assert.equal((await request(`/imports/${foreign}/file`, 'owner')).status, 404);
  assert.equal((await request(`/imports/${foreign}/approve`, 'owner', 'POST', { jobId: job })).status, 404);
  const response = await request('/imports', 'owner');
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data.some((row: any) => row.id === foreign), false);
});

test('a newly approved similar invoice is surfaced to the other reviewer before a confirmed second purchase', async () => {
  const invoiceNumber = randomUUID();
  const records = [];
  for (const rawText of ['Paint version one ABC123 1 25.00 25.00', 'Paint version two ABC123 1 25.00 25.00']) {
    const response = await request('/imports', 'owner', 'POST', { supplier: 'Sherwin-Williams', invoiceNumber, invoiceDate: '2026-03-10', rawText });
    assert.equal(response.status, 201, await response.clone().text());
    records.push((await response.json() as any).data);
  }
  const first = await request(`/imports/${records[0].id}/approve`, 'owner', 'POST', { jobId: job });
  assert.equal(first.status, 200, await first.clone().text());
  const purchaseId = (await first.json() as any).data.purchase.id;
  const second = await request(`/imports/${records[1].id}/approve`, 'owner', 'POST', { jobId: job });
  assert.equal(second.status, 409, await second.clone().text());
  const refreshed = await request('/imports');
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const current = (await refreshed.json() as any).data.find((row: any) => row.id === records[1].id);
  assert.equal(current.extractedData.possibleDuplicatePurchaseId, purchaseId);
  assert.equal(current.status, 'needs_review');
  assert.equal((await request(`/imports/${records[1].id}/approve`, 'owner', 'POST', { jobId: job, confirmSimilarPurchase: true })).status, 200);
});

test('concurrent identical binary uploads incur one extraction and retain one authorized file', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  const retained = new Map<string, ArrayBuffer>();
  const uploadEnv = {
    ...env, OPENAI_API_KEY: 'synthetic-key-never-sent-to-a-provider',
    R2: {
      put: async (key: string, body: ArrayBuffer) => { retained.set(key, body); },
      get: async (key: string) => retained.has(key) ? { body: retained.get(key) } : null,
    },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    providerCalls++;
    assert.equal(JSON.parse(String(options?.body)).max_output_tokens, 3000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return Response.json({
      usage: { input_tokens: 200, output_tokens: 150, total_tokens: 350 },
      output_text: JSON.stringify({ supplier: 'Sherwin-Williams', invoiceNumber: 'SYNTHETIC-123', invoiceDate: '2026-03-10',
        totalAmount: 100, confidence: 0.95, rawText: 'Synthetic two-gallon invoice', items: [
          { description: 'Duration Satin', size: 'GALLON', sku: 'sw-duration', quantity: 2, unitCost: 50, gallons: 2, total: 100 },
        ] }),
    }, { headers: { 'x-request-id': 'synthetic-provider-request' } });
  };
  try {
    const upload = () => {
      const form = new FormData();
      form.set('sourceType', 'upload');
      form.set('file', new File(['%PDF-1.7\nsynthetic-never-sent'], 'receipt.pdf', { type: 'application/pdf' }));
      return invoices.fetch(new Request('http://localhost/imports', {
        method: 'POST', headers: { Authorization: 'Bearer owner', 'Idempotency-Key': randomUUID() }, body: form,
      }), uploadEnv as never);
    };
    const outcomes = await Promise.all(Array.from({ length: 6 }, upload));
    assert.equal(providerCalls, 1);
    assert.equal(outcomes.filter((response) => response.status === 201).length, 1);
    for (const response of outcomes) assert.ok([201, 409].includes(response.status), await response.clone().text());
    const { data } = await outcomes.find((response) => response.status === 201)!.json() as any;
    assert.equal(data.extractedData.storedInR2, true);
    assert.equal(retained.size, 1);
    const fileResponse = await invoices.fetch(new Request(`http://localhost/imports/${data.id}/file`, {
      headers: { Authorization: 'Bearer owner' },
    }), uploadEnv as never);
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(fileResponse.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(await fileResponse.text(), /synthetic-never-sent/);
    assert.equal((await upload()).status, 409);
    assert.equal(providerCalls, 1);
    assert.equal((await pool.query('SELECT count(*) FROM ai_usage_events WHERE org_id=$1', [orgA])).rows[0].count, '1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
