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
    ],
    features: [
      'leadPipeline',
      'quickEstimates',
      'publicProposals',
      'manualPayments',
      'jobScheduling',
      'basicReports',
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
    ],
    limits: {
      adminUsers: 3,
      fieldUsers: 10,
      monthlyOcrDocuments: 10,
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
      'OCR supplier invoice import',
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
  return planDefinition(plan).features.includes(feature);
}

export function planFeaturesPayload(plan: unknown) {
  const definition = planDefinition(plan);
  return {
    displayName: definition.displayName,
    legacyDisplayName: definition.legacyDisplayName,
    seatCopy: definition.seatCopy,
    userLimit: definition.limits.adminUsers,
    fieldUserLimit: definition.limits.fieldUsers,
    limits: definition.limits,
    features: definition.features,
    featureCopy: definition.featureCopy,
    trialDays: TRIAL_DAYS,
  };
}
