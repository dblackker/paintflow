import { createDb } from '@crewmodo/db';
import { saasPlans, subscriptions } from '@crewmodo/db/schema';
import { desc, eq } from 'drizzle-orm';
import { resolvePlanCapabilities, type PlanCapabilities } from '@crewmodo/core';

type CapabilityDb = ReturnType<typeof createDb>;

export function orgCapabilityGrants(planFeatures: unknown, orgId: string): unknown {
  if (!planFeatures || typeof planFeatures !== 'object' || Array.isArray(planFeatures)) return undefined;
  const grants = (planFeatures as Record<string, unknown>).capabilityGrantsByOrg;
  if (!grants || typeof grants !== 'object' || Array.isArray(grants) || !Object.hasOwn(grants, orgId)) return undefined;
  return (grants as Record<string, unknown>)[orgId];
}

/**
 * Read only the authenticated/routed tenant. Grants are opt-in server-owned JSON
 * at saas_plans.features.capabilityGrantsByOrg[orgId]. A shared plan record must
 * not grant every tenant an individual customer's negotiated capability override.
 * Legacy feature snapshots are not grants.
 * No environment, demo, or invoice-automation flag bypasses the subscription.
 */
export async function readOrgCapabilities(
  db: CapabilityDb,
  orgId: string,
  now = new Date(),
): Promise<PlanCapabilities> {
  if (!orgId) throw new Error('Organization context is required.');
  const [subscription] = await db.select({
    planName: saasPlans.name,
    status: subscriptions.status,
    currentPeriodEnd: subscriptions.currentPeriodEnd,
    planFeatures: saasPlans.features,
  })
    .from(subscriptions)
    .leftJoin(saasPlans, eq(subscriptions.planId, saasPlans.id))
    .where(eq(subscriptions.orgId, orgId))
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(1);

  return resolvePlanCapabilities({
    plan: subscription?.planName,
    status: subscription?.status,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    grants: orgCapabilityGrants(subscription?.planFeatures, orgId),
    now,
  });
}
