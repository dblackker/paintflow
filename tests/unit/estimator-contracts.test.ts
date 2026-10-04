import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../apps/api/src/index';
import { parseProductionEstimationInput } from '../../apps/api/src/lib/production-estimation';
import { buildJobName } from '../../apps/api/src/lib/estimate-handoff';

test('draft account identity comes only from an authenticated non-cacheable session', async () => {
  const env = { ENVIRONMENT: 'production', KV: { get: async (key: string) => key === 'session:synthetic'
    ? JSON.stringify({ orgId: 'tenant-a', userId: 'user-a', email: 'unused@example.invalid', expiresAt: Date.now() + 10000 }) : null } };
  const ctx = { waitUntil: () => {} };
  const noSession = await worker.fetch(new Request('https://example.invalid/v1/auth/session'), env as never, ctx as never);
  assert.equal(noSession.status, 401);
  const response = await worker.fetch(new Request('https://example.invalid/v1/auth/session', { headers: { Authorization: 'Bearer synthetic' } }), env as never, ctx as never);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { data: { orgId: 'tenant-a', userId: 'user-a' } });
});

test('bounded room recovery metadata survives API parsing without creating pricing items', () => {
  const editorState = { rooms: [{ id: 'room-a', name: 'Bedroom', dimensions: { length: '12', width: '10' } }], roomDefaults: { paint: 'sample' } };
  const parsed = parseProductionEstimationInput({ calculationVersion: 'repaint-v2', items: [], editorState });
  assert.deepEqual((parsed as typeof parsed & { editorState: unknown }).editorState, editorState);
  assert.equal(parsed.items.length, 0);
  assert.throws(() => parseProductionEstimationInput({ calculationVersion: 'repaint-v2', items: [], editorState: { oversized: 'x'.repeat(2_000_001) } }), /measurements/);
});

test('color separation commitments survive the bounded API contract without accepting cost internals', () => {
  const parsed = parseProductionEstimationInput({ calculationVersion: 'repaint-v2', items: [{
    id: 'room-walls', productionRateId: '00000000-0000-4000-8000-000000000001', quantity: '416', colorRelationship: 'different',
    operations: [{ id: 'mask', kind: 'masking', hours: '2', description: 'Mask for a separate ceiling color', privateCost: 999 }],
  }] });
  assert.equal(parsed.items[0].operations![0].description, 'Mask for a separate ceiling color');
  assert.equal('privateCost' in parsed.items[0].operations![0], false);
  assert.throws(() => parseProductionEstimationInput({ items: [{ productionRateId: '00000000-0000-4000-8000-000000000001',
    operations: [{ id: 'mask', kind: 'masking', hours: '2', description: 'x'.repeat(301) }],
  }] }), /measurements/);
});

test('long customer and site names cannot break accepted job creation', () => {
  const name = buildJobName({ name: 'Customer '.repeat(35), streetAddress: 'Project address '.repeat(20) } as never, null);
  assert.ok(Array.from(name).length <= 255);
  assert.ok(name.endsWith('...'));
});
