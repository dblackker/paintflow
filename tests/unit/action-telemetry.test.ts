import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionEvent, sendActionEvent } from '../../apps/api/src/lib/action-telemetry';

const outcome = { action: 'estimate.saved' as const, orgId: 'private-workspace', actorId: 'private-user', entityId: 'private-document', occurredAt: '2026-10-03T12:00:00.000Z' };
test('analytics retry retains event identity and strips business identifiers', async () => {
  const first = await actionEvent(outcome);
  assert.deepEqual(first, await actionEvent(outcome));
  assert.notEqual(first.uuid, (await actionEvent({ ...outcome, orgId: 'different-workspace' })).uuid);
  assert.doesNotMatch(JSON.stringify(first), /private-/);
  assert.equal(first.properties.$process_person_profile, false);
});
test('analytics is disabled unless explicitly configured and fails without blocking an action', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('provider down'); };
  try {
    await sendActionEvent({}, outcome);
    await sendActionEvent({ POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: 'test', POSTHOG_HOST: 'https://unapproved.invalid' }, outcome);
    assert.equal(calls, 0);
    await sendActionEvent({ POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: 'test' }, outcome);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
