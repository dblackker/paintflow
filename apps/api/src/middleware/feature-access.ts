import type { Context, MiddlewareHandler } from 'hono';
import { createDb } from '@crewmodo/db';
import { checkCapability, type FeatureKey, type PlanCapabilities } from '@crewmodo/core';
import type { Env, Variables } from '../types';
import { readOrgCapabilities } from '../lib/entitlements';

type FeatureContext = Context<{ Bindings: Env; Variables: Variables }>;
type CapabilityReader = (c: FeatureContext) => Promise<PlanCapabilities>;

const requestCapabilities = new WeakMap<FeatureContext, Promise<PlanCapabilities>>();
const readCapabilities: CapabilityReader = (c) => {
  let capabilities = requestCapabilities.get(c);
  if (!capabilities) {
    capabilities = readOrgCapabilities(createDb(c.env.DATABASE_URL), c.get('orgId'));
    requestCapabilities.set(c, capabilities);
  }
  return capabilities;
};

/** Run after auth and alongside RBAC. A plan feature never authorizes a user by itself. */
export function requireFeatureAccess(
  feature: FeatureKey,
  read: CapabilityReader = readCapabilities,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    if (!c.get('userId') || !c.get('orgId') || !c.get('session')) {
      return c.json({ error: 'Sign in to continue.', code: 'NO_SESSION' }, 401);
    }
    let capabilities: PlanCapabilities;
    try {
      capabilities = await read(c);
    } catch {
      return c.json({
        error: 'Subscription access could not be checked. Try again.',
        code: 'ENTITLEMENTS_UNAVAILABLE',
      }, 503);
    }
    const decision = checkCapability(capabilities, feature);
    if ('code' in decision) {
      return c.json({ error: decision.message, code: decision.code, feature, plan: capabilities.plan }, 403);
    }
    await next();
  };
}
