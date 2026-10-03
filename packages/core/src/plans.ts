export type PlanKey = 'starter' | 'pro' | 'enterprise';

export type FeatureKey =
  | 'leadPipeline'
  | 'quickEstimates'
  | 'productionEstimator'
  | 'publicProposals'
  | 'manualPayments'
  | 'paymentSchedules'
  | 'changeOrders'
  | 'jobScheduling'
  | 'basicReports'
  | 'teamTimeBasic'
  | 'gpsTimeTracking'
  | 'timeApprovals'
  | 'jobCosting'
  | 'supplierCatalog'
  | 'messaging'
  | 'notifications'
  | 'emailTemplates'
  | 'automations'
  | 'advancedReporting'
  | 'ocrInvoiceImport'
  | 'rolesPermissions'
  | 'multiCrewScheduling'
  | 'apiAccess'
  | 'prioritySupport';

export interface PlanLimits {
  adminUsers: number | null;
  fieldUsers: number | null;
  monthlyOcrDocuments: number;
  monthlySmsIncluded: number;
  monthlyAiEstimatedCents: number;
}

export interface PlanDefinition {
  key: PlanKey;
  displayName: string;
  price: string;
  interval: 'month';
  stripeEnvKey: string;
  audience: string;
  seatCopy: string;
  featureCopy: string[];
  features: FeatureKey[];
  limits: PlanLimits;
  legacyDisplayName?: string;
}

export const TRIAL_DAYS = 14;

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: 'starter',
    displayName: 'Starter',
    price: '79.00',
    interval: 'month',
    stripeEnvKey: 'STRIPE_STARTER_PRICE_ID',
    audience: 'Owner-operators and very small crews getting out of spreadsheets.',
    seatCopy: '1 admin + 3 field-only crew',
    featureCopy: [
      'Lead pipeline',
      'Quick estimates',
      'Public proposals and e-sign',
      'Basic jobs and scheduling',
      'Manual payments',
      'Basic reports',
      'Basic crew time',
    ],
    features: [
      'leadPipeline',
      'quickEstimates',
      'publicProposals',
      'manualPayments',
      'jobScheduling',
      'basicReports',
      'teamTimeBasic',
    ],
    limits: {
      adminUsers: 1,
      fieldUsers: 3,
      monthlyOcrDocuments: 0,
      monthlySmsIncluded: 0,
      monthlyAiEstimatedCents: 0,
    },
  },
  pro: {
    key: 'pro',
    displayName: 'Growth',
    legacyDisplayName: 'Pro',
    price: '199.00',
    interval: 'month',
    stripeEnvKey: 'STRIPE_PRO_PRICE_ID',
    audience: 'Small and mid-sized contractors running sales, production, and job cost together.',
    seatCopy: '3 admins + 10 field-only crew',
    featureCopy: [
      'Everything in Starter',
      'Production estimator',
      'Payment schedules and change orders',
      'Crew time with GPS and approvals',
      'Job costing',
      'Email templates and notifications',
      'Supplier catalog',
      '100 supplier invoice imports per month',
    ],
    features: [
      'leadPipeline',
      'quickEstimates',
      'productionEstimator',
      'publicProposals',
      'manualPayments',
      'paymentSchedules',
      'changeOrders',
      'jobScheduling',
      'basicReports',
      'teamTimeBasic',
      'gpsTimeTracking',
      'timeApprovals',
      'jobCosting',
      'supplierCatalog',
      'messaging',
      'notifications',
      'emailTemplates',
      'ocrInvoiceImport',
    ],
    limits: {
      adminUsers: 3,
      fieldUsers: 10,
      monthlyOcrDocuments: 100,
      monthlySmsIncluded: 250,
      monthlyAiEstimatedCents: 2000,
    },
  },
  enterprise: {
    key: 'enterprise',
    displayName: 'Pro',
    legacyDisplayName: 'Enterprise',
    price: '399.00',
    interval: 'month',
    stripeEnvKey: 'STRIPE_ENTERPRISE_PRICE_ID',
    audience: 'Multi-crew operators that need controls, reporting, automation, and higher usage limits.',
    seatCopy: '8 admins + 25 field-only crew',
    featureCopy: [
      'Everything in Growth',
      'Higher messaging and AI allowances',
      'Advanced reports',
      'Recommended actions and automations',
      'Advanced roles and permissions',
      'Multi-crew scheduling',
      'Priority support',
    ],
    features: [
      'leadPipeline',
      'quickEstimates',
      'productionEstimator',
      'publicProposals',
      'manualPayments',
      'paymentSchedules',
      'changeOrders',
      'jobScheduling',
      'basicReports',
      'teamTimeBasic',
      'gpsTimeTracking',
      'timeApprovals',
      'jobCosting',
      'supplierCatalog',
      'messaging',
      'notifications',
      'emailTemplates',
      'automations',
      'advancedReporting',
      'ocrInvoiceImport',
      'rolesPermissions',
      'multiCrewScheduling',
      'apiAccess',
      'prioritySupport',
    ],
    limits: {
      adminUsers: 8,
      fieldUsers: 25,
      monthlyOcrDocuments: 100,
      monthlySmsIncluded: 1000,
      monthlyAiEstimatedCents: 10000,
    },
  },
};

export const PLAN_ORDER: PlanKey[] = ['starter', 'pro', 'enterprise'];

export function normalizePlanKey(value: unknown): PlanKey {
  return value === 'starter' || value === 'enterprise' ? value : 'pro';
}

export function planDefinition(plan: unknown): PlanDefinition {
  return PLAN_DEFINITIONS[normalizePlanKey(plan)];
}

export function hasPlanFeature(plan: unknown, feature: FeatureKey) {
  const key = parsePlanKey(plan);
  return key !== null && PLAN_DEFINITIONS[key].features.includes(feature);
}

export function planFeaturesPayload(plan: unknown) {
  const definition = planDefinition(plan);
  return {
    displayName: definition.displayName,
    legacyDisplayName: definition.legacyDisplayName,
    seatCopy: definition.seatCopy,
    userLimit: definition.limits.adminUsers,
    fieldUserLimit: definition.limits.fieldUsers,
    limits: { ...definition.limits },
    features: [...definition.features],
    featureCopy: [...definition.featureCopy],
    trialDays: TRIAL_DAYS,
  };
}

// Checkout keeps its legacy normalization; authorization must not default to Growth.
export function parsePlanKey(value: unknown): PlanKey | null {
  return value === 'starter' || value === 'pro' || value === 'enterprise' ? value : null;
}

export type CapabilityDenialCode =
  | 'SUBSCRIPTION_REQUIRED'
  | 'UNKNOWN_PLAN'
  | 'SUBSCRIPTION_INACTIVE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'FEATURE_NOT_INCLUDED';

export type PlanLimitKey = keyof PlanLimits;

export interface CapabilityGrants {
  features?: Partial<Record<FeatureKey, boolean>>;
  limits?: Partial<PlanLimits>;
  expiresAt?: Date | string | null;
}

export interface SubscriptionCapabilityInput {
  plan?: unknown;
  status?: string | null;
  currentPeriodEnd?: Date | string | null;
  /** Explicit server-owned grants, not prices or the historical plan feature list. */
  grants?: unknown;
  now?: Date;
}

export interface PlanCapabilities {
  schemaVersion: 1;
  plan: PlanKey | null;
  displayName: string | null;
  status: string;
  accessState: 'active' | 'trial' | 'canceled_until_period_end' | 'inactive';
  denialCode: Exclude<CapabilityDenialCode, 'FEATURE_NOT_INCLUDED'> | null;
  accessUntil: string | null;
  features: FeatureKey[];
  limits: PlanLimits;
  grantsApplied: boolean;
}

export type CapabilityDecision =
  | { allowed: true }
  | { allowed: false; code: CapabilityDenialCode; message: string };

export type PlanLimitDecision =
  | { allowed: true; remaining: number | null }
  | {
      allowed: false;
      code: Exclude<CapabilityDenialCode, 'FEATURE_NOT_INCLUDED'> | 'LIMIT_REACHED' | 'INVALID_USAGE';
      message: string;
    };

const EMPTY_LIMITS: PlanLimits = {
  adminUsers: 0,
  fieldUsers: 0,
  monthlyOcrDocuments: 0,
  monthlySmsIncluded: 0,
  monthlyAiEstimatedCents: 0,
};

const CAPABILITY_MESSAGES: Record<CapabilityDenialCode, string> = {
  SUBSCRIPTION_REQUIRED: 'Finish subscription setup to use this feature.',
  UNKNOWN_PLAN: 'Your subscription plan needs review. Contact support.',
  SUBSCRIPTION_INACTIVE: 'Review your subscription to restore access.',
  SUBSCRIPTION_EXPIRED: 'Your subscription access has ended. Review billing to continue.',
  FEATURE_NOT_INCLUDED: 'This feature is not included in your plan.',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyCapabilityGrants(
  features: FeatureKey[],
  limits: PlanLimits,
  value: unknown,
  now: number,
): boolean {
  const grants = record(value);
  if (!grants) return false;
  if (grants.expiresAt !== undefined && grants.expiresAt !== null) {
    const expiry = typeof grants.expiresAt === 'string' || grants.expiresAt instanceof Date
      ? timestamp(grants.expiresAt)
      : null;
    if (expiry === null || expiry <= now) return false;
  }

  let applied = false;
  const featureGrants = record(grants.features);
  if (featureGrants) {
    const knownFeatures = new Set(PLAN_ORDER.flatMap((key) => PLAN_DEFINITIONS[key].features));
    for (const key of knownFeatures) {
      const enabled = featureGrants[key];
      if (typeof enabled !== 'boolean') continue;
      const index = features.indexOf(key);
      if (enabled && index === -1) features.push(key);
      if (!enabled && index !== -1) features.splice(index, 1);
      applied = true;
    }
  }

  const limitGrants = record(grants.limits);
  if (limitGrants) {
    for (const key of Object.keys(EMPTY_LIMITS) as PlanLimitKey[]) {
      const limit = limitGrants[key];
      if (limit === null && (key === 'adminUsers' || key === 'fieldUsers')) {
        limits[key] = null;
        applied = true;
      } else if (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0) {
        limits[key] = limit;
        applied = true;
      }
    }
  }
  return applied;
}

/**
 * Subscription access is independent of RBAC and of the customer's price/price ID.
 * Missing trial dates fail closed. Legacy active subscriptions without a period
 * end remain active; canceled access requires a known future period end. A
 * past-due renewal's period end is not proof of payment and grants no grace itself.
 */
export function resolvePlanCapabilities(input: SubscriptionCapabilityInput): PlanCapabilities {
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) throw new RangeError('A valid current date is required.');
  const plan = parsePlanKey(input.plan);
  const status = input.status || 'missing';
  const periodEnd = timestamp(input.currentPeriodEnd);
  const result: PlanCapabilities = {
    schemaVersion: 1,
    plan,
    displayName: plan ? PLAN_DEFINITIONS[plan].displayName : null,
    status,
    accessState: 'inactive',
    denialCode: null,
    accessUntil: periodEnd === null ? null : new Date(periodEnd).toISOString(),
    features: [],
    limits: { ...EMPTY_LIMITS },
    grantsApplied: false,
  };

  if (status === 'missing') result.denialCode = 'SUBSCRIPTION_REQUIRED';
  else if (!plan) result.denialCode = 'UNKNOWN_PLAN';
  else if (input.currentPeriodEnd != null && periodEnd === null) result.denialCode = 'SUBSCRIPTION_INACTIVE';
  else if (status === 'active') {
    if (periodEnd !== null && periodEnd <= now) result.denialCode = 'SUBSCRIPTION_EXPIRED';
    else result.accessState = 'active';
  } else if (status === 'trial' || status === 'trialing') {
    if (periodEnd === null) result.denialCode = 'SUBSCRIPTION_INACTIVE';
    else if (periodEnd <= now) result.denialCode = 'SUBSCRIPTION_EXPIRED';
    else result.accessState = 'trial';
  } else if (status === 'canceled') {
    if (periodEnd === null) result.denialCode = 'SUBSCRIPTION_INACTIVE';
    else if (periodEnd <= now) result.denialCode = 'SUBSCRIPTION_EXPIRED';
    else result.accessState = 'canceled_until_period_end';
  } else result.denialCode = 'SUBSCRIPTION_INACTIVE';

  if (result.denialCode !== null || !plan) return result;
  result.features = [...PLAN_DEFINITIONS[plan].features];
  result.limits = { ...PLAN_DEFINITIONS[plan].limits };
  result.grantsApplied = applyCapabilityGrants(result.features, result.limits, input.grants, now);
  return result;
}

export function checkCapability(capabilities: PlanCapabilities, feature: FeatureKey): CapabilityDecision {
  if (capabilities.denialCode) {
    return { allowed: false, code: capabilities.denialCode, message: CAPABILITY_MESSAGES[capabilities.denialCode] };
  }
  if (!capabilities.features.includes(feature)) {
    return { allowed: false, code: 'FEATURE_NOT_INCLUDED', message: CAPABILITY_MESSAGES.FEATURE_NOT_INCLUDED };
  }
  return { allowed: true };
}

/** A preflight check, not a concurrency-safe usage or seat reservation. */
export function checkPlanLimit(
  capabilities: PlanCapabilities,
  key: PlanLimitKey,
  used: number,
  requested = 1,
): PlanLimitDecision {
  if (capabilities.denialCode) {
    return { allowed: false, code: capabilities.denialCode, message: CAPABILITY_MESSAGES[capabilities.denialCode] };
  }
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(requested) || requested <= 0) {
    return { allowed: false, code: 'INVALID_USAGE', message: 'Usage could not be verified. Refresh and try again.' };
  }
  const limit = capabilities.limits[key];
  if (limit === null) return { allowed: true, remaining: null };
  if (requested > limit - used) {
    return { allowed: false, code: 'LIMIT_REACHED', message: 'Your plan limit has been reached. Review your plan to continue.' };
  }
  return { allowed: true, remaining: limit - used - requested };
}
