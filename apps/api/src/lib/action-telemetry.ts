import type { Context } from 'hono';
import type { Env, Variables } from '../types';

export type ActionMilestone = 'estimate.saved' | 'estimate.accepted' | 'supplier.invoice.approved';
type Outcome = { action: ActionMilestone; orgId: string; actorId: string; entityId: string; occurredAt: string };

async function opaqueId(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function actionEvent(outcome: Outcome) {
  const actor = await opaqueId(`crewmodo:actor:${outcome.orgId}:${outcome.actorId}`);
  return {
    event: outcome.action,
    distinct_id: actor,
    uuid: await opaqueId(`crewmodo:outcome:${outcome.orgId}:${outcome.action}:${outcome.entityId}:${outcome.occurredAt}`),
    timestamp: outcome.occurredAt,
    properties: { $process_person_profile: false, tenant: await opaqueId(`crewmodo:tenant:${outcome.orgId}`), schema_version: 1 },
  };
}

export async function sendActionEvent(env: Pick<Env, 'POSTHOG_ENABLED' | 'POSTHOG_PROJECT_TOKEN' | 'POSTHOG_HOST'>, outcome: Outcome) {
  if (env.POSTHOG_ENABLED !== 'true' || !env.POSTHOG_PROJECT_TOKEN) return;
  const host = env.POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host)) return;
  const event = await actionEvent(outcome);
  try {
    const response = await fetch(`${host}/i/v0/e/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, api_key: env.POSTHOG_PROJECT_TOKEN }), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) console.warn('Action analytics unavailable', { action: outcome.action, status: response.status });
  } catch {
    console.warn('Action analytics unavailable', { action: outcome.action });
  }
}

// Operational records remain authoritative. Analytics is opt-in, best-effort and
// never receives form values, names, addresses, documents, location or money.
export function queueActionEvent(c: Context<{ Bindings: Env; Variables: Variables }>, outcome: Outcome) {
  const pending = sendActionEvent(c.env, outcome).catch(() => undefined);
  try { c.executionCtx.waitUntil(pending); } catch { void pending; }
}
