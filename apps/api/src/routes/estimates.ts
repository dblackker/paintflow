import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { auditLogs, customerPayments, emailSends, emailTemplates, estimatePhotos, estimates, jobs, leads, orgBranding, orgSettings, portalTokens, users } from '@crewmodo/db/schema';
import { and, eq, desc, inArray, isNull, sql } from 'drizzle-orm';
import { ESTIMATION_CALCULATION_VERSION, EstimationInputError, calculateProductionEstimate, formatEstimationMinor } from '../../../../packages/core/src/estimation';
import { resolveProductionEstimation, productionEstimationFieldErrors } from '../lib/production-estimation';
import { camelRecord, supplierCall, SupplierOperationError } from '../lib/supplier-operations';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { requireOrgPermission } from '../middleware/financial-access';
import { sendEmail, renderEstimateEmail } from '../lib/email';
import { createJobFromAcceptedEstimate, estimateContractValue } from '../lib/estimate-handoff';
import { estimatePaymentSchedule } from '../lib/payment-schedule';
import { legalSettingsFromPreferences, readPreferenceObject } from '../lib/legal-settings';
import { createDepositInvoiceForEstimate } from '../lib/customer-invoices';
import { sendInvoiceEmail } from '../lib/invoice-emails';
import { queueActionEvent } from '../lib/action-telemetry';
import { acceptedOptionPricing, buildAcceptedEstimationBudget, matchAcceptedOptions, type AcceptedBudgetPackage } from '../../../../packages/core/src/estimation-budget';
import { publicEstimatePackages } from '../../../../packages/core/src/estimation-public';
import { deliverAcceptedEstimate } from '../lib/accepted-estimate-delivery';
import { buildJobName, selectEstimatePackage } from '../lib/estimate-handoff';
import { nextPayableMilestone } from '../lib/payment-schedule';
import { currentProposalTerms, proposalTerms, proposalTermsVersion, proposalPaymentSettings } from '../lib/proposal-terms';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
const CLIENT_VIEW_THROTTLE_MS = 30 * 60 * 1000;
const CONTRACTOR_SIGNATURE_ACTIONS = ['estimate.email.sent', 'estimate.email.updated', 'estimate.contractor.countersigned'];

const selectedOptionSchema = z.object({
  desc: z.string().trim().min(1).max(500),
  qty: z.coerce.number().positive().default(1),
  rate: z.coerce.number().nonnegative(),
  category: z.string().trim().max(120).optional(),
  calculationItemId: z.string().max(200).optional(),
  optionIndex: z.number().int().min(0).max(500).optional(),
});

const signSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedTermsVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  name: z.string().min(1).max(255),
  signatureData: z.string().min(100).max(100000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Draw your signature before approving.'),
  packageName: z.string().optional(),
  selectedOptions: z.array(selectedOptionSchema).max(20).optional(),
  acknowledgedDisclosure: z.boolean().optional(),
});

const estimateLineItemSchema = z.object({
  calculationItemId: z.string().trim().min(1).max(150).optional(),
  calculatedSubtotalMinor: z.number().int().nonnegative().safe().optional(),
  desc: z.string().trim().min(1).max(500),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  category: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  kind: z.enum(['surface', 'line_item']).optional(),
  customerVisible: z.boolean().optional(),
  optional: z.boolean().optional(),
  productionRateId: z.string().uuid().optional(),
  roomName: z.string().trim().max(255).optional(),
  surfaceName: z.string().trim().max(255).optional(),
  group: z.string().trim().max(255).optional(),
  dimensions: z.object({
    width: z.coerce.number().nonnegative().optional(),
    height: z.coerce.number().nonnegative().optional(),
    quantity: z.coerce.number().nonnegative().optional(),
    unit: z.string().trim().max(20).optional(),
  }).optional(),
  labor: z.object({
    hours: z.coerce.number().nonnegative().optional(),
    rate: z.coerce.number().nonnegative().optional(),
    cost: z.coerce.number().nonnegative().optional(),
    coats: z.coerce.number().int().positive().optional(),
    prepLevel: z.string().trim().max(50).optional(),
    applicationMethod: z.string().trim().max(50).optional(),
    productionRatePerHour: z.coerce.number().nonnegative().optional(),
    prepAdjustmentHours: z.coerce.number().optional(),
    paintAdjustmentHours: z.coerce.number().optional(),
    ceilingColorSeparation: z.string().trim().max(80).optional(),
    ceilingColorSeparationHours: z.coerce.number().nonnegative().optional(),
  }).optional(),
  material: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().max(255).optional(),
    brand: z.string().trim().max(100).optional(),
    supplier: z.string().trim().max(255).optional(),
    unit: z.string().trim().max(20).optional(),
    quantity: z.coerce.number().nonnegative().optional(),
    costPerUnit: z.coerce.number().nonnegative().optional(),
    markupPercent: z.coerce.number().nonnegative().optional(),
    price: z.coerce.number().nonnegative().optional(),
    colorName: z.string().trim().max(120).optional(),
    colorCode: z.string().trim().max(80).optional(),
    status: z.string().trim().max(50).optional(),
    crewNote: z.string().trim().max(500).optional(),
  }).optional(),
});

const estimatePackageSchema = z.object({
  calculationVersion: z.enum(['repaint-v1', 'repaint-v2']).optional(),
  productionInput: z.unknown().optional(),
  calculationInput: z.unknown().optional(),
  estimateType: z.enum(['interior', 'exterior', 'mixed']).optional(),
  name: z.string().min(1).max(100),
  subtotal: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  tax: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().positive().optional(),
  items: z.array(estimateLineItemSchema).min(1).optional(),
  lineItems: z.array(estimateLineItemSchema).min(1).optional(),
}).transform((pkg) => {
  const items = pkg.items ?? pkg.lineItems ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const discount = Number(pkg.discount ?? 0);
  const computedTotal = Math.max(subtotal - discount, 0);

  return {
    calculationVersion: pkg.calculationVersion,
    productionInput: pkg.productionInput,
    calculationInput: pkg.calculationInput,
    estimateType: pkg.estimateType,
    name: pkg.name,
    subtotal: Number(pkg.subtotal ?? subtotal),
    discount,
    tax: Number(pkg.tax ?? 0),
    total: Number(pkg.total ?? computedTotal),
    items,
    lineItems: items,
  };
}).refine((pkg) => pkg.items.length > 0, {
  message: 'Each package needs at least one line item',
  path: ['items'],
});

export async function priceEstimatePackages(db: ReturnType<typeof createDb>, orgId: string, packages: z.infer<typeof estimatePackageSchema>[], context: { postalCode?: string | null; actorId?: string | null } = {}) {
  const settings = packages.some((pkg) => !pkg.calculationVersion)
    ? await db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }) : null;
  return Promise.all(packages.map(async (pkg) => {
    if (!pkg.calculationVersion) {
      if (pkg.productionInput || pkg.calculationInput) throw new EstimationInputError('calculationVersion', 'Reload the production estimator before saving.');
      const calculation = calculateProductionEstimate({
        currency: 'USD', surfaces: [], discount: pkg.discount,
        taxRate: { kind: 'fraction', value: settings?.salesTaxRate ?? '0' },
        adjustments: pkg.items.map((item, index) => ({ id: `legacy-${index}`, quantity: item.qty, unitPrice: item.rate, optional: item.optional })),
      });
      return { ...pkg, subtotal: Number(formatEstimationMinor(calculation.totals.subtotalMinor)),
        discount: Number(formatEstimationMinor(calculation.totals.discountMinor)), tax: Number(formatEstimationMinor(calculation.totals.taxMinor)),
        total: Number(formatEstimationMinor(calculation.totals.totalMinor)), pricingSnapshot: { version: ESTIMATION_CALCULATION_VERSION, calculation } };
    }
    const { productionInput, resolvedInput, calculation, rates, materials, taxSnapshot } = await resolveProductionEstimation(db, orgId, pkg.productionInput, context);
    if (pkg.calculationVersion !== calculation.calculationVersion) throw new EstimationInputError('calculationVersion', 'The selected pricing version does not match this scope. Review the estimate again.');
    const lines = new Map(calculation.items.map((line) => [line.id, line]));
    const submittedIds = new Set<string>();
    const items = pkg.items.map((item) => {
      const id = item.calculationItemId;
      const line = id ? lines.get(id) : undefined;
      if (!id || !line || submittedIds.has(id)) throw new EstimationInputError('items', 'Each scope item must match one calculated substrate or adjustment.');
      submittedIds.add(id);
      const source = productionInput.items.find((surface) => surface.id === id);
      const adjustment = productionInput.adjustments?.find((row) => row.id === id);
      const rate = source ? rates.find((row) => row.id === source.productionRateId)! : null;
      const finishId = source?.materialId || source?.coatingLayers?.find((layer) => layer.phase === 'finish')?.materialId;
      const product = finishId ? materials.find((row) => row.id === finishId) : null;
      return {
        ...item, calculationItemId: id, calculatedSubtotalMinor: line.subtotalMinor,
        optional: !line.included,
        // Selling lines carry allocated cents; measured quantities remain separate scope metadata.
        qty: 1, rate: Number(formatEstimationMinor(line.subtotalMinor)),
        productionRateId: rate?.id, category: rate?.unit || item.category,
        dimensions: source ? { ...item.dimensions, quantity: Number(line.quantity), unit: line.unit } : item.dimensions,
        labor: source ? { ...item.labor, hours: Number(line.hours), cost: Number(formatEstimationMinor(line.laborMinor)),
          rate: Number(resolvedInput.surfaces.find((surface) => surface.id === id)?.labor.sellingRate || '0'), coats: source.coats ?? rate?.coats,
          ceilingColorSeparation: source.colorRelationship,
          productionRatePerHour: Number(rate?.ratePerHour || '0') } : undefined,
        coatingLayers: source?.coatingLayers?.map((layer) => {
          const coating = materials.find((row) => row.id === layer.materialId)!;
          return { ...layer, name: coating.name, brand: coating.brand, sheen: coating.sheen };
        }),
        scopeCommitments: line.operations?.filter((operation) => ['masking', 'cut_in'].includes(operation.kind) && Number(operation.hours) > 0)
          .map((operation) => operation.description || (operation.kind === 'masking' ? 'Masking for color separation' : 'Cut-in for color separation')),
        material: product ? { ...item.material, id: product.id, name: product.name, brand: product.brand, supplier: product.supplier,
          unit: product.unit, costPerUnit: Number(product.costPerUnit), quantity: Number(line.allocatedPacks || '0'),
          price: Number(formatEstimationMinor(line.materialMinor)), acquisitionCost: Number(formatEstimationMinor(line.materialCostMinor)),
          colorName: source?.colorName, colorCode: source?.colorCode, sheen: product.sheen, purchaseGroupId: line.materialGroupId,
          theoreticalGallons: line.theoreticalGallons } : undefined,
      };
    });
    for (const line of calculation.items) {
      if (!submittedIds.has(line.id) && ['estimator:mobilization', 'estimator:minimum'].includes(line.id)) {
        items.push({ calculationItemId: line.id, calculatedSubtotalMinor: line.subtotalMinor, desc: line.id === 'estimator:minimum' ? 'Project minimum' : 'Mobilization',
          qty: 1, rate: Number(formatEstimationMinor(line.subtotalMinor)), optional: false, category: 'other', kind: 'line_item', customerVisible: true,
          productionRateId: undefined, dimensions: undefined, labor: undefined, material: undefined, coatingLayers: undefined, scopeCommitments: undefined });
        submittedIds.add(line.id);
      }
    }
    if (calculation.items.some((line) => Number(line.quantity) > 0 && !submittedIds.has(line.id))) {
      throw new EstimationInputError('items', 'The proposal is missing a calculated scope item. Review the current scope again.');
    }
    return { ...pkg, items, lineItems: items, productionInput, calculationVersion: calculation.calculationVersion,
      calculationInput: resolvedInput, calculationSnapshot: calculation, taxSnapshot, taxRate: taxSnapshot.value,
      subtotal: Number(formatEstimationMinor(calculation.totals.subtotalMinor)), discount: Number(formatEstimationMinor(calculation.totals.discountMinor)),
      tax: Number(formatEstimationMinor(calculation.totals.taxMinor)), total: Number(formatEstimationMinor(calculation.totals.totalMinor)),
      optionalTotal: Number(formatEstimationMinor(calculation.totals.optionalSubtotalMinor)) };
  }));
}

const createEstimateSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  leadId: z.string().uuid(),
  streetAddress: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  status: z.enum(['draft', 'sent']).default('sent'),
  packages: z.array(estimatePackageSchema).max(5),
}).superRefine((data, ctx) => {
  if (data.status === 'sent' && data.packages.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Sent estimates need at least one priced package',
      path: ['packages'],
    });
  }
});

async function savedOperation(db: ReturnType<typeof createDb>, orgId: string, actor: string, key: string, request: string) {
  const result = await db.execute(sql`select request = ${request}::jsonb as matches, result
    from operation_results where org_id=${orgId}::uuid and action='estimate.save'
      and actor=${actor} and operation_key=${key}`);
  const row = result.rows[0] as { matches: boolean; result: { estimate: Record<string, unknown>; replayed: boolean } } | undefined;
  if (row && !row.matches) throw new SupplierOperationError('This save key was already used for different details.', 409, 'IDEMPOTENCY_CONFLICT');
  return row ? { ...row.result, replayed: true } : null;
}

function saveOperationKey(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const key = c.req.header('Idempotency-Key')?.trim();
  if (!key || key.length > 200) throw new SupplierOperationError('A valid save key is required. Reload this page and try again.', 400, 'INVALID_OPERATION_KEY');
  return key;
}

function estimateSaveResponse(c: Context<{ Bindings: Env; Variables: Variables }>, result: { estimate: Record<string, unknown>; replayed: boolean }, created = false) {
  const estimate = camelRecord<typeof estimates.$inferSelect>(result.estimate);
  for (const key of ['createdAt', 'updatedAt', 'sentAt', 'signedAt'] as const) {
    const value = estimate[key];
    if (typeof value === 'string') estimate[key] = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  }
  const publicUrl = publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.crewmodo.com', estimate.id);
  queueActionEvent(c, { action: 'estimate.saved', orgId: estimate.orgId, actorId: c.get('userId')!, entityId: estimate.id, occurredAt: estimate.updatedAt.toISOString() });
  return c.json({ data: { ...estimate, recommendedTotal: estimateContractValue(estimate), publicUrl, customerPreviewUrl: publicUrl }, replayed: result.replayed }, created && !result.replayed ? 201 : 200);
}

const cancelEstimateSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const agreementActionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const sendEstimateEmailSchema = z.object({
  reason: z.enum(['sent', 'updated']).optional(),
});

function contractorSignatureFromMetadata(metadata: unknown) {
  const raw = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).contractorSignature
    : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const signature = raw as Record<string, unknown>;
  const name = String(signature.name || '').trim();
  const companyName = String(signature.companyName || '').trim();
  const signedAt = String(signature.signedAt || '').trim();
  if (!name || !signedAt) return null;
  return {
    name,
    email: String(signature.email || '').trim() || null,
    title: String(signature.title || '').trim() || 'Authorized representative',
    companyName: companyName || null,
    signedAt,
    capacity: String(signature.capacity || '').trim() || (companyName ? `Authorized representative for ${companyName}` : 'Authorized representative'),
  };
}

async function estimateContractorSignature(db: ReturnType<typeof createDb>, estimate: typeof estimates.$inferSelect) {
  const latest = await db.query.auditLogs.findFirst({
    where: and(
      eq(auditLogs.orgId, estimate.orgId),
      eq(auditLogs.entityType, 'estimate'),
      eq(auditLogs.entityId, estimate.id),
      inArray(auditLogs.action, CONTRACTOR_SIGNATURE_ACTIONS),
    ),
    orderBy: (auditLogs, { desc }) => [desc(auditLogs.createdAt)],
  });
  if (!estimate.signedAt && latest) {
    const metadata = latest.metadata as { agreementUpdatedAt?: string } | null;
    if (metadata?.agreementUpdatedAt && metadata.agreementUpdatedAt !== estimate.updatedAt.toISOString()) return null;
    const lastChange = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.orgId, estimate.orgId), eq(auditLogs.entityType, 'estimate'),
        eq(auditLogs.entityId, estimate.id), inArray(auditLogs.action, ['estimate.updated', 'estimate.draft.updated'])),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    if (lastChange && lastChange.createdAt.getTime() > latest.createdAt.getTime()) return null;
  }
  return contractorSignatureFromMetadata(latest?.metadata);
}

async function buildContractorSignature(db: ReturnType<typeof createDb>, orgId: string, userId?: string | null) {
  const [branding, settings, estimator] = await Promise.all([
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
    userId ? db.query.users.findFirst({ where: eq(users.id, userId) }) : Promise.resolve(null),
  ]);
  const signerName = estimator?.name || estimator?.email || settings?.companyName || branding?.companyName || 'Authorized representative';
  const companyName = branding?.companyName || settings?.companyName || 'your painting contractor';
  return {
    name: signerName,
    email: estimator?.email || settings?.email || null,
    title: 'Authorized representative',
    companyName,
    capacity: `Authorized representative for ${companyName}`,
    signedAt: new Date().toISOString(),
  };
}

function selectedOptionsForPackage(estimate: typeof estimates.$inferSelect, packageName: string | undefined, selectedOptions: z.infer<typeof selectedOptionSchema>[]) {
  const packages = Array.isArray(estimate.packages) ? estimate.packages as Array<{ name: string; items?: unknown[]; lineItems?: unknown[] }> : [];
  const pkg = packages.find((item) => item.name === packageName) ?? packages.find((item) => item.name === 'proposal') ?? packages[0];
  const optionalItems = (Array.isArray(pkg?.items) ? pkg.items : Array.isArray(pkg?.lineItems) ? pkg.lineItems : []) as Array<{
    desc?: string;
    qty?: number;
    rate?: number;
    category?: string;
    optional?: boolean;
    customerVisible?: boolean;
  }>;
  return matchAcceptedOptions(optionalItems as NonNullable<AcceptedBudgetPackage['items']>, selectedOptions);
}

async function freezeProposalTerms(db: ReturnType<typeof createDb>, estimate: typeof estimates.$inferSelect) {
  const settings = await db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, estimate.orgId) });
  const terms = currentProposalTerms(settings || {});
  const frozen = await db.execute(sql`update estimates set proposal_terms_snapshot=coalesce(proposal_terms_snapshot,${JSON.stringify(terms)}::jsonb)
    where id=${estimate.id}::uuid and org_id=${estimate.orgId}::uuid and signed_at is null and status in ('draft','sent')
      and date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',${estimate.updatedAt.toISOString()}::timestamptz at time zone 'UTC')
    returning proposal_terms_snapshot`);
  return Boolean(frozen.rows[0]);
}

function createPortalToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createClientPortalLink(db: ReturnType<typeof createDb>, env: Env, orgId: string, leadId: string) {
  const token = createPortalToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(portalTokens).values({ orgId, leadId, token, expiresAt });
  return `${env.PUBLIC_URL || 'https://crewmodo.com'}/portal/${token}`;
}

function estimateJobsite(estimate: typeof estimates.$inferSelect, lead?: typeof leads.$inferSelect | null) {
  return {
    streetAddress: estimate.streetAddress || lead?.streetAddress || null,
    city: estimate.city || lead?.city || null,
    state: estimate.state || lead?.state || null,
    postalCode: estimate.postalCode || lead?.postalCode || null,
  };
}

async function recordPublicEstimateView(db: ReturnType<typeof createDb>, c: Context<{ Bindings: Env; Variables: Variables }>, estimate: typeof estimates.$inferSelect) {
  if (!['sent', 'accepted'].includes(estimate.status)) return;
  if (c.get('userId')) return;

  const latestView = await db.query.auditLogs.findFirst({
    where: and(
      eq(auditLogs.orgId, estimate.orgId),
      eq(auditLogs.entityType, 'estimate'),
      eq(auditLogs.entityId, estimate.id),
      eq(auditLogs.action, 'estimate.client_viewed'),
    ),
    orderBy: (auditLogs, { desc }) => [desc(auditLogs.createdAt)],
  });

  if (latestView && Date.now() - new Date(latestView.createdAt).getTime() < CLIENT_VIEW_THROTTLE_MS) {
    return;
  }

  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || c.req.header('X-Real-IP') || '';
  const userAgent = c.req.header('User-Agent') || '';
  await db.insert(auditLogs).values({
    orgId: estimate.orgId,
    action: 'estimate.client_viewed',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: estimate.leadId,
      status: estimate.status,
      source: 'public_estimate_preview',
    },
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });
}

estimatesApp.get('/:id/public', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const branding = await db.query.orgBranding.findFirst({
    where: eq(orgBranding.orgId, estimate.orgId),
  });
  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, estimate.orgId),
  });
  const terms = proposalTerms(estimate.proposalTermsSnapshot, settings || {});
  const legal = terms.legal;

  const photos = await db.query.estimatePhotos.findMany({
    where: eq(estimatePhotos.estimateId, estimate.id),
    orderBy: (photos, { desc }) => [desc(photos.createdAt)],
  });
  const payments = await optionalPaymentRows(db.select().from(customerPayments)
    .where(and(eq(customerPayments.estimateId, estimate.id), eq(customerPayments.orgId, estimate.orgId))));
  const paidAmount = payments
    .filter((payment) => ['succeeded', 'paid'].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);
  const total = estimateContractValue(estimate);
  const acceptance = estimate.acceptanceSnapshot as { paymentSchedule?: unknown[]; paymentTerms?: string; legal?: typeof legal } | null;
  const paymentSchedule = estimatePaymentSchedule(acceptance?.paymentSchedule
    ? { businessHours: { paymentSchedule: { enabled: true, milestones: acceptance.paymentSchedule } } } : proposalPaymentSettings(terms), total, paidAmount);
  const contractorSignature = await estimateContractorSignature(db, estimate);
  const latestPortalToken = estimate.signedAt
    ? await db.query.portalTokens.findFirst({
      where: and(eq(portalTokens.orgId, estimate.orgId), eq(portalTokens.leadId, estimate.leadId)),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    })
    : null;
  await recordPublicEstimateView(db, c, estimate);
  
  return c.json({ 
    data: {
      id: estimate.id,
      ...estimateJobsite(estimate),
      packages: publicEstimatePackages(estimate.packages, estimate.acceptanceSnapshot),
      total: total.toFixed(2),
      status: estimate.status,
      createdAt: estimate.createdAt,
      updatedAt: estimate.updatedAt,
      termsVersion: await proposalTermsVersion(terms),
      sentAt: estimate.sentAt,
      signedName: estimate.signedName,
      signedAt: estimate.signedAt,
      contractorSignature,
      portalUrl: latestPortalToken && new Date() <= latestPortalToken.expiresAt
        ? `${c.env.PUBLIC_URL || 'https://crewmodo.com'}/portal/${latestPortalToken.token}`
        : null,
      paymentSummary: {
        paidAmount: Math.max(paidAmount, 0),
        paymentCount: payments.length,
        balanceDue: Math.max(total - paidAmount, 0),
      },
      paymentSchedule,
      paymentTerms: acceptance?.paymentTerms || terms.paymentTerms,
      legal: acceptance?.legal || legal,
      photos,
      branding: branding ? {
        logoUrl: branding.logoUrl,
        primaryColor: branding.primaryColor,
        companyName: branding.companyName,
      } : null,
    }
  });
});

estimatesApp.post('/:id/sign', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = signSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.errors }, 400);
  }
  
  const { name, signatureData, packageName, selectedOptions = [], acknowledgedDisclosure = false } = parsed.data;
  
  const db = createDb(c.env.DATABASE_URL);
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const userAgent = c.req.header('User-Agent') || 'unknown';

  const existing = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }
  const request = JSON.stringify(parsed.data);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request));
  const approvalKey = c.req.header('Idempotency-Key')?.trim() || Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (approvalKey.length > 200) return c.json({ error: 'Reload the proposal and try signing again.' }, 400);
  const priorApproval = await db.execute(sql`select request=${request}::jsonb as matches,result from operation_results
    where org_id=${existing.orgId}::uuid and action='estimate.accept' and actor=${id} and operation_key=${approvalKey}`);
  const prior = priorApproval.rows[0] as { matches: boolean; result: Record<string, unknown> } | undefined;
  if (prior) {
    if (!prior.matches) return c.json({ error: 'This approval key was used for different details.' }, 409);
    return c.json({ data: { ...prior.result, replayed: true } });
  }
  if (existing.status === 'canceled') {
    return c.json({ error: 'This estimate has been canceled' }, 409);
  }
  if (['superseded', 'voided'].includes(existing.status)) {
    return c.json({ error: 'This estimate agreement is no longer active' }, 409);
  }
  if (existing.status === 'accepted') {
    return c.json({ error: 'This estimate has already been accepted' }, 409);
  }
  if (existing.status !== 'sent') return c.json({ error: 'This proposal is not available for signing.' }, 409);
  if (existing.signedAt) {
    return c.json({ error: 'This estimate has already been signed' }, 409);
  }

  const contractorSignature = await estimateContractorSignature(db, existing);
  if (!contractorSignature) {
    return c.json({ error: 'The contractor has not countersigned this proposal yet. Ask the contractor to send or update the proposal before signing.' }, 409);
  }

  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, existing.orgId),
  });
  const terms = proposalTerms(existing.proposalTermsSnapshot, settings || {});
  const legal = terms.legal;
  if (legal.disclosureEnabled && legal.disclosureRequired && !acknowledgedDisclosure) {
    return c.json({ error: 'Please acknowledge the required disclosure before signing.' }, 400);
  }
  
  let cleanOptions: ReturnType<typeof selectedOptionsForPackage>;
  try { cleanOptions = selectedOptionsForPackage(existing, packageName, selectedOptions); }
  catch (error) {
    if (error instanceof EstimationInputError) return c.json({ error: error.message, code: error.code }, 400);
    throw error;
  }
  const selectedPackage = selectEstimatePackage(existing, packageName) as AcceptedBudgetPackage | null;
  if (!selectedPackage) return c.json({ error: 'Select a proposal before signing.' }, 400);
  const termsVersion = await proposalTermsVersion(terms);
  if ((parsed.data.expectedTermsVersion && parsed.data.expectedTermsVersion !== termsVersion) ||
    (selectedPackage.calculationVersion === 'repaint-v2' && !parsed.data.expectedTermsVersion)) {
    return c.json({ error: 'The agreement terms changed. Reload the proposal before signing.', code: 'ESTIMATE_TERMS_CONFLICT' }, 409);
  }
  if ((parsed.data.expectedUpdatedAt && parsed.data.expectedUpdatedAt !== existing.updatedAt.toISOString()) ||
    (selectedPackage.calculationVersion === 'repaint-v2' && !parsed.data.expectedUpdatedAt)) {
    return c.json({ error: 'This proposal changed while you were reviewing it. Reload it before signing.', code: 'ESTIMATE_VERSION_CONFLICT' }, 409);
  }
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, existing.leadId), eq(leads.orgId, existing.orgId)) });
  if (!lead) return c.json({ error: 'Customer not found.' }, 404);
  let contractValue: number;
  let budget: ReturnType<typeof buildAcceptedEstimationBudget>;
  try {
    contractValue = acceptedOptionPricing(selectedPackage, cleanOptions).totalMinor / 100;
    budget = buildAcceptedEstimationBudget(id, selectedPackage, cleanOptions, new Date().toISOString());
  } catch (error) {
    if (error instanceof EstimationInputError) return c.json({ error: error.message, code: error.code }, 400);
    throw error;
  }
  const milestone = nextPayableMilestone(estimatePaymentSchedule(proposalPaymentSettings(terms), contractValue));
  const token = crypto.randomUUID().replace(/-/g, '');
  const portalUrl = `${c.env.PUBLIC_URL || 'https://crewmodo.com'}/portal/${token}`;
  const deposit = milestone && milestone.amount > 0 ? {
    invoiceNumber: `DEP-${id.slice(0, 8).toUpperCase()}-${milestone.key.replace(/[^a-z0-9]/gi, '').slice(0, 16).toUpperCase()}`,
    description: `${milestone.label} for signed proposal`, amount: milestone.amount.toFixed(2), dueLabel: milestone.due,
    lineItems: [{ description: milestone.label, quantity: 1, unitPrice: milestone.amount, total: milestone.amount, category: 'deposit', milestoneKey: milestone.key, milestoneDue: milestone.due, estimateId: id }],
  } : null;
  const payload = {
    signedName: name, signatureData, ip, userAgent, budget, reviewedTerms: terms, reviewedPackages: existing.packages,
    reviewedJobsite: { leadId: existing.leadId, streetAddress: existing.streetAddress, city: existing.city, state: existing.state, postalCode: existing.postalCode },
    contractValue: contractValue.toFixed(2),
    jobNumber: `JOB-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    jobName: buildJobName({ ...lead, streetAddress: existing.streetAddress || lead.streetAddress }, { ...selectedPackage, total: selectedPackage.total ?? existing.total }),
    deposit, portalToken: token, portalUrl,
    acceptance: { contractTotalMinor: budget.contractTotalMinor, packageName: selectedPackage.name, selectedOptions: cleanOptions,
      paymentSchedule: estimatePaymentSchedule(proposalPaymentSettings(terms), contractValue), paymentTerms: terms.paymentTerms, legal, termsVersion },
    audit: {
      packageName: packageName ?? null,
      contractValue,
      selectedOptions: cleanOptions,
      awaitingPayment: Boolean(deposit),
      contractorSignature,
      legalSnapshot: legal,
      acknowledgedDisclosure: Boolean(legal.disclosureEnabled && acknowledgedDisclosure),
    },
  };
  try {
    const result = await supplierCall<Record<string, unknown>>(db, sql`select accept_estimate_budget(${existing.orgId}::uuid,${id}::uuid,
      ${approvalKey},${existing.updatedAt.toISOString()}::timestamp,${request}::jsonb,${JSON.stringify(payload)}::jsonb) as result`);
    if (!result.replayed) queueActionEvent(c, { action: 'estimate.accepted', orgId: existing.orgId, actorId: id, entityId: id, occurredAt: String(budget.acceptedAt) });
    if (typeof result.deliveryId === 'string' && c.env.RESEND_API_KEY) {
      const delivery = deliverAcceptedEstimate(c.env, existing.orgId, result.deliveryId).catch(() => console.warn('accepted_estimate_delivery_deferred', { estimateId: id }));
      try { c.executionCtx.waitUntil(delivery); } catch { await delivery; }
    }
    return c.json({ data: result });
  } catch (error) {
    if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

estimatesApp.use('*', authMiddleware);
estimatesApp.use('*', requireOrgPermission(['manage_estimates'], 'Ask an owner for permission to manage proposals.'));

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  const db = createDb(c.env.DATABASE_URL);
  
  const rows = await db.query.estimates.findMany({
    where: eq(estimates.orgId, orgId),
    orderBy: [desc(estimates.createdAt)],
    limit,
    offset,
  });

  const leadIds = [...new Set(rows.map((estimate) => estimate.leadId))];
  const leadRows = leadIds.length
    ? await db.select().from(leads).where(and(eq(leads.orgId, orgId), inArray(leads.id, leadIds)))
    : [];
  const leadsById = new Map(leadRows.map((lead) => [lead.id, lead]));
  const data = rows.map((estimate) => ({
    ...estimate,
    payments: [] as Array<typeof customerPayments.$inferSelect>,
    leadName: leadsById.get(estimate.leadId)?.name ?? 'Customer',
    leadPhone: leadsById.get(estimate.leadId)?.phone,
    leadEmail: leadsById.get(estimate.leadId)?.email,
    leadStreetAddress: leadsById.get(estimate.leadId)?.streetAddress,
    leadCity: leadsById.get(estimate.leadId)?.city,
    leadState: leadsById.get(estimate.leadId)?.state,
    leadPostalCode: leadsById.get(estimate.leadId)?.postalCode,
    ...estimateJobsite(estimate, leadsById.get(estimate.leadId)),
    publicUrl: publicEstimateUrl(baseUrl, estimate.id),
    customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id),
  }));

  const estimateIds = rows.map((estimate) => estimate.id);
  const paymentRows = estimateIds.length
    ? await optionalPaymentRows(db.select().from(customerPayments)
      .where(and(eq(customerPayments.orgId, orgId), inArray(customerPayments.estimateId, estimateIds)))
      .orderBy(desc(customerPayments.receivedAt)))
    : [];
  const paymentsByEstimate = new Map<string, Array<typeof customerPayments.$inferSelect>>();
  paymentRows.forEach((payment) => {
    if (!payment.estimateId) return;
    const list = paymentsByEstimate.get(payment.estimateId) || [];
    list.push(payment);
    paymentsByEstimate.set(payment.estimateId, list);
  });
  data.forEach((estimate) => {
    estimate.payments = paymentsByEstimate.get(estimate.id) || [];
  });
  
  return c.json({ data });
});

estimatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const actor = c.get('userId')!;
  let key: string;
  try { key = saveOperationKey(c); }
  catch (error) { if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status); throw error; }
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const request = JSON.stringify({ estimateId: null, data: parsed.data });
  try {
    const replay = await savedOperation(db, orgId, actor, key, request);
    if (replay) return estimateSaveResponse(c, replay, true);
  } catch (error) { if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status); throw error; }
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  let packages: Awaited<ReturnType<typeof priceEstimatePackages>>;
  try { packages = await priceEstimatePackages(db, orgId, parsed.data.packages, { postalCode: parsed.data.postalCode || lead.postalCode, actorId: actor }); }
  catch (error) {
    if (error instanceof EstimationInputError) return c.json({ error: error.message, code: error.code, fields: productionEstimationFieldErrors(error) }, 400);
    throw error;
  }

  const isDraft = parsed.data.status === 'draft';
  const recommendedPackage = packages.find((pkg) => /better|recommended/i.test(pkg.name)) ?? packages[0];
  const estimateTotal = recommendedPackage ? Number(recommendedPackage.total).toFixed(2) : '0.00';

  try {
    const result = await supplierCall<{ estimate: Record<string, unknown>; replayed: boolean }>(db, sql`select save_unsigned_estimate(
      ${orgId}::uuid, ${actor}::uuid, ${key}, ${request}::jsonb, null::uuid, null::timestamp,
      ${JSON.stringify({ ...parsed.data, streetAddress: parsed.data.streetAddress || lead.streetAddress,
        city: parsed.data.city || lead.city, state: parsed.data.state || lead.state,
        postalCode: parsed.data.postalCode || lead.postalCode, packages, total: estimateTotal })}::jsonb
    ) as result`);
    return estimateSaveResponse(c, result, true);
  } catch (error) {
    if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

estimatesApp.get('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }

  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  const payments = await optionalPaymentRows(db.select().from(customerPayments)
    .where(and(eq(customerPayments.orgId, orgId), eq(customerPayments.estimateId, estimate.id)))
    .orderBy(desc(customerPayments.receivedAt)));
  const contractorSignature = await estimateContractorSignature(db, estimate);
  const deliveryRows = estimate.signedAt ? await db.execute(sql`select status,attempts,last_error as "lastError",sent_at as "sentAt",invoice_id as "invoiceId"
    from accepted_estimate_deliveries where org_id=${orgId}::uuid and estimate_id=${estimate.id}::uuid`) : { rows: [] };
  return c.json({ data: { ...estimate, payments, contractorSignature, acceptanceDelivery: deliveryRows.rows[0] ?? null,
    publicUrl: publicEstimateUrl(baseUrl, estimate.id), customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id) } });
});

estimatesApp.post('/:id/cancel', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = cancelEstimateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid cancellation request', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (estimate.status === 'accepted' || estimate.signedAt) {
    return c.json({ error: 'Signed estimates cannot be canceled here. Use a change order, new estimate agreement, or close the job instead.' }, 409);
  }
  if (estimate.status === 'canceled') {
    return c.json({ data: { ...estimate, publicUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.crewmodo.com', estimate.id), customerPreviewUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.crewmodo.com', estimate.id) } });
  }

  const [updated] = await db.update(estimates)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'estimate.canceled',
    entityType: 'estimate',
    entityId: updated.id,
    metadata: {
      leadId: updated.leadId,
      previousStatus: estimate.status,
      reason: parsed.data.reason || null,
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  return c.json({ data: { ...updated, payments: [], publicUrl: publicEstimateUrl(baseUrl, updated.id), customerPreviewUrl: publicEstimateUrl(baseUrl, updated.id) } });
});

estimatesApp.post('/:id/void', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = agreementActionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid void request', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) return c.json({ error: 'Not found' }, 404);
  if (!estimate.signedAt && estimate.status !== 'accepted') {
    return c.json({ error: 'Only signed agreements can be voided. Use cancel for unsigned estimates.' }, 409);
  }
  if (estimate.status === 'voided') {
    const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
    return c.json({ data: { ...estimate, publicUrl: publicEstimateUrl(baseUrl, estimate.id), customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id) } });
  }
  if (estimate.status === 'superseded') {
    return c.json({ error: 'This agreement was superseded by a revision.' }, 409);
  }

  const [updated] = await db.update(estimates)
    .set({ status: 'voided', updatedAt: new Date() })
    .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'estimate.agreement.voided',
    entityType: 'estimate',
    entityId: updated.id,
    metadata: {
      leadId: updated.leadId,
      previousStatus: estimate.status,
      reason: parsed.data.reason || null,
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  return c.json({ data: { ...updated, publicUrl: publicEstimateUrl(baseUrl, updated.id), customerPreviewUrl: publicEstimateUrl(baseUrl, updated.id) } });
});

estimatesApp.post('/:id/revise', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = agreementActionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid revision request', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) return c.json({ error: 'Not found' }, 404);
  if (!estimate.signedAt && estimate.status !== 'accepted') {
    return c.json({ error: 'Only signed agreements need revisions. Edit unsigned sent estimates directly.' }, 409);
  }
  if (['voided', 'superseded'].includes(estimate.status)) {
    return c.json({ error: 'This agreement is no longer active.' }, 409);
  }

  const now = new Date();
  const [revision] = await db.insert(estimates)
    .values({
      orgId,
      leadId: estimate.leadId,
      streetAddress: estimate.streetAddress,
      city: estimate.city,
      state: estimate.state,
      postalCode: estimate.postalCode,
      packages: estimate.packages,
      total: estimate.total,
      status: 'draft',
    })
    .returning();

  const [superseded] = await db.update(estimates)
    .set({ status: 'superseded', updatedAt: now })
    .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values([
    {
      orgId,
      userId: c.get('userId'),
      action: 'estimate.revision.created',
      entityType: 'estimate',
      entityId: revision.id,
      metadata: {
        leadId: revision.leadId,
        previousEstimateId: estimate.id,
        reason: parsed.data.reason || null,
      },
    },
    {
      orgId,
      userId: c.get('userId'),
      action: 'estimate.agreement.superseded',
      entityType: 'estimate',
      entityId: superseded.id,
      metadata: {
        leadId: superseded.leadId,
        revisionEstimateId: revision.id,
        reason: parsed.data.reason || null,
      },
    },
  ]);

  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  return c.json({
    data: {
      ...revision,
      supersededEstimateId: superseded.id,
      publicUrl: publicEstimateUrl(baseUrl, revision.id),
      customerPreviewUrl: publicEstimateUrl(baseUrl, revision.id),
      editUrl: `/estimates/production?estimateId=${revision.id}`,
    },
  }, 201);
});

estimatesApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const actor = c.get('userId')!;
  let key: string;
  try { key = saveOperationKey(c); }
  catch (error) { if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status); throw error; }
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), issues: parsed.error.issues }, 400);
  }

  if (!parsed.data.expectedUpdatedAt) return c.json({ error: 'Reload this estimate before saving changes.', code: 'ESTIMATE_VERSION_REQUIRED' }, 409);

  const db = createDb(c.env.DATABASE_URL);
  const request = JSON.stringify({ estimateId: id, data: parsed.data });
  try {
    const replay = await savedOperation(db, orgId, actor, key, request);
    if (replay) return estimateSaveResponse(c, replay);
  } catch (error) { if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.code }, error.status); throw error; }
  const existing = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }
  const canEditSent = existing.status === 'sent' && !existing.signedAt;
  if (existing.status !== 'draft' && !canEditSent) {
    return c.json({ error: 'Only draft or unsigned sent estimates can be edited' }, 409);
  }

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  let packages: Awaited<ReturnType<typeof priceEstimatePackages>>;
  try { packages = await priceEstimatePackages(db, orgId, parsed.data.packages, { postalCode: parsed.data.postalCode || lead.postalCode, actorId: actor }); }
  catch (error) {
    if (error instanceof EstimationInputError) return c.json({ error: error.message, code: error.code, fields: productionEstimationFieldErrors(error) }, 400);
    throw error;
  }

  const isDraft = existing.status === 'draft' && parsed.data.status === 'draft';
  const recommendedPackage = packages.find((pkg) => /better|recommended/i.test(pkg.name)) ?? packages[0];
  const estimateTotal = recommendedPackage ? Number(recommendedPackage.total).toFixed(2) : '0.00';
  try {
    const result = await supplierCall<{ estimate: Record<string, unknown>; replayed: boolean }>(db, sql`select save_unsigned_estimate(
      ${orgId}::uuid, ${actor}::uuid, ${key}, ${request}::jsonb, ${id}::uuid,
      ${parsed.data.expectedUpdatedAt}::timestamptz at time zone 'UTC',
      ${JSON.stringify({ ...parsed.data, status: isDraft ? 'draft' : 'sent', streetAddress: parsed.data.streetAddress || lead.streetAddress,
        city: parsed.data.city || lead.city, state: parsed.data.state || lead.state,
        postalCode: parsed.data.postalCode || lead.postalCode, packages, total: estimateTotal })}::jsonb
    ) as result`);
    return estimateSaveResponse(c, result);
  } catch (error) {
    if (error instanceof SupplierOperationError) return c.json({ error: error.message, code: error.status === 409 ? 'ESTIMATE_VERSION_CONFLICT' : error.code }, error.status);
    throw error;
  }
});

estimatesApp.get('/:id/activity', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }

  const rows = await db.query.auditLogs.findMany({
    where: and(eq(auditLogs.orgId, orgId), eq(auditLogs.entityType, 'estimate'), eq(auditLogs.entityId, id)),
    orderBy: [desc(auditLogs.createdAt)],
    limit: 100,
  });

  return c.json({ data: rows });
});

function packageItems(pkg: unknown) {
  const value = pkg as { items?: unknown[]; lineItems?: unknown[] } | undefined;
  return Array.isArray(value?.items) ? value.items : Array.isArray(value?.lineItems) ? value.lineItems : [];
}

function proposalScopeSummary(estimate: typeof estimates.$inferSelect) {
  const packages = Array.isArray(estimate.packages) ? estimate.packages as Array<{ name?: string; items?: unknown[]; lineItems?: unknown[] }> : [];
  const pkg = packages.find((item) => item.name === 'proposal') ?? packages[0];
  const groups = new Map<string, Set<string>>();
  packageItems(pkg)
    .map((item) => item as { customerVisible?: boolean; optional?: boolean; roomName?: string; desc?: string; surfaceName?: string; labor?: { coats?: number }; material?: { brand?: string; name?: string; colorName?: string; colorCode?: string } })
    .filter((item) => item.customerVisible !== false && !item.optional)
    .forEach((item) => {
      const desc = String(item.desc || '');
      const room = item.roomName || desc.split(':')[0] || 'Project';
      const surface = item.surfaceName || desc.replace(/^[^:]+:\s*/, '') || 'Scope item';
      const details = [
        surface,
        item.labor?.coats ? `${Number(item.labor.coats)} coat${Number(item.labor.coats) === 1 ? '' : 's'}` : '',
        item.material?.name ? [item.material.brand, item.material.name].filter(Boolean).join(' ') : '',
        [item.material?.colorName, item.material?.colorCode].filter(Boolean).join(' '),
      ].filter(Boolean).join(' - ');
      if (!groups.has(room)) groups.set(room, new Set());
      groups.get(room)?.add(details);
    });

  return Array.from(groups.entries()).slice(0, 8).map(([space, substrates]) => ({
    space,
    substrates: Array.from(substrates).slice(0, 6),
  }));
}

function estimateProjectType(estimate: typeof estimates.$inferSelect) {
  const packages = Array.isArray(estimate.packages) ? estimate.packages as Array<{ estimateType?: string }> : [];
  const explicit = packages.find((pkg) => pkg.estimateType)?.estimateType;
  if (explicit) return explicit;
  const summary = JSON.stringify(estimate.packages || '').toLowerCase();
  if (summary.includes('exterior')) return 'exterior';
  if (summary.includes('interior')) return 'interior';
  return 'standard';
}

function estimateEmailTemplateKey(projectType: string) {
  const type = projectType.toLowerCase();
  if (type.includes('interior')) return 'estimate.interior.sent';
  if (type.includes('exterior')) return 'estimate.exterior.sent';
  return 'estimate.standard.sent';
}

function publicEstimateUrl(baseUrl: string, id: string) {
  return `${baseUrl.replace(/\/$/, '')}/estimates/${id}`;
}

function isMissingRelation(error: unknown) {
  const err = error as { code?: string; message?: string };
  return err?.code === '42P01' || /relation .* does not exist/i.test(err?.message || '');
}

async function findEmailTemplateOverride(db: ReturnType<typeof createDb>, orgId: string, templateKey: string) {
  try {
    return await db.query.emailTemplates.findFirst({
      where: and(eq(emailTemplates.orgId, orgId), eq(emailTemplates.key, templateKey), eq(emailTemplates.isActive, true)),
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      console.warn('Email template overrides unavailable; run email communications migration.');
      return null;
    }
    throw error;
  }
}

async function recordEmailSend(db: ReturnType<typeof createDb>, values: typeof emailSends.$inferInsert) {
  try {
    const [emailSend] = await db.insert(emailSends).values(values).returning();
    return emailSend;
  } catch (error) {
    if (isMissingRelation(error)) {
      console.warn('Email send logging unavailable; run email communications migration.');
      return null;
    }
    throw error;
  }
}

async function optionalPaymentRows<T>(query: Promise<T[]>) {
  try {
    return await query;
  } catch (error) {
    if (isMissingRelation(error)) {
      console.warn('Payment history unavailable; run payments migration.');
      return [];
    }
    throw error;
  }
}

estimatesApp.post('/:id/countersign', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (['canceled', 'voided', 'superseded'].includes(estimate.status)) {
    return c.json({ error: 'Only active or signed estimate agreements can be countersigned.' }, 409);
  }

  const existingSignature = await estimateContractorSignature(db, estimate);
  if (existingSignature) {
    const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
    return c.json({
      data: {
        contractorSignature: existingSignature,
        alreadySigned: true,
        publicUrl: publicEstimateUrl(baseUrl, estimate.id),
        customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id),
      },
    });
  }

  const contractorSignature = await buildContractorSignature(db, orgId, userId);
  if (!estimate.signedAt && !await freezeProposalTerms(db, estimate)) {
    return c.json({ error: 'This proposal changed. Reload it before countersigning.', code: 'ESTIMATE_VERSION_CONFLICT' }, 409);
  }
  await db.insert(auditLogs).values({
    orgId,
    userId,
    action: 'estimate.contractor.countersigned',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: estimate.leadId,
      status: estimate.status,
      contractorSignature,
      agreementUpdatedAt: estimate.updatedAt.toISOString(),
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  return c.json({
    data: {
      contractorSignature,
      alreadySigned: false,
      publicUrl: publicEstimateUrl(baseUrl, estimate.id),
      customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id),
    },
  });
});

estimatesApp.post('/:id/send-email', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = sendEstimateEmailSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid email request', details: parsed.error.flatten() }, 400);
  }
  const db = createDb(c.env.DATABASE_URL);

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });

  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, estimate.leadId), eq(leads.orgId, orgId)),
  });

  if (!lead?.email) {
    return c.json({ error: 'Lead email is required before sending an estimate' }, 400);
  }

  if (estimate.status !== 'sent' || estimate.signedAt) {
    return c.json({ error: 'Only unsigned sent proposals can be sent from this action.' }, 409);
  }
  if (!await freezeProposalTerms(db, estimate)) {
    return c.json({ error: 'This proposal changed. Reload it before sending.', code: 'ESTIMATE_VERSION_CONFLICT' }, 409);
  }

  const branding = await db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) });
  const settings = await db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) });
  const userId = c.get('userId');
  const estimator = userId
    ? await db.query.users.findFirst({ where: eq(users.id, userId) })
    : null;
  const baseUrl = c.env.PUBLIC_URL || 'https://app.crewmodo.com';
  const previewUrl = publicEstimateUrl(baseUrl, estimate.id);
  const total = estimateContractValue(estimate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const projectType = estimateProjectType(estimate);
  const templateKey = estimateEmailTemplateKey(projectType);
  const isUpdateEmail = parsed.data.reason === 'updated';
  const signerName = estimator?.name || estimator?.email || settings?.companyName || branding?.companyName || 'Authorized representative';
  const companyName = branding?.companyName || settings?.companyName || 'your painting contractor';
  const contractorSignature = await buildContractorSignature(db, orgId, userId);
  const templateOverride = await findEmailTemplateOverride(db, orgId, isUpdateEmail ? 'estimate.updated.sent' : templateKey);
  const renderedEmail = renderEstimateEmail({
    estimateId: estimate.id,
    leadName: lead.name,
    total,
    baseUrl,
    companyName,
    estimatorName: signerName,
    estimatorEmail: settings?.email || estimator?.email || null,
    estimatorPhone: settings?.phone || null,
    estimateType: projectType,
    scopeSummary: proposalScopeSummary(estimate),
    isUpdate: isUpdateEmail,
  }, templateOverride);
  const fromEmail = c.env.EMAIL_FROM || 'estimates@crewmodo.com';
  const replyTo = settings?.email || estimator?.email || undefined;

  const providerResult = await sendEmail(c.env, lead.email, renderedEmail.subject, renderedEmail.html, undefined, {
    replyTo,
    text: renderedEmail.text,
  }) as { id?: string; message_id?: string };
  const emailSend = await recordEmailSend(db, {
    orgId,
    leadId: lead.id,
    estimateId: estimate.id,
    templateKey: renderedEmail.templateKey,
    templateName: renderedEmail.templateName,
    channel: renderedEmail.channel,
    toEmail: lead.email,
    fromEmail,
    replyTo: replyTo || null,
    subject: renderedEmail.subject,
    previewText: renderedEmail.preheader,
    renderedHtml: renderedEmail.html,
    renderedText: renderedEmail.text,
    status: 'sent',
    provider: c.env.EMAIL_PROVIDER || (c.env.MAILCHANNELS_API_KEY ? 'mailchannels' : 'resend'),
    providerMessageId: providerResult?.id || providerResult?.message_id || null,
    sentBy: c.get('userId'),
    metadata: {
      estimateType: projectType,
      link: previewUrl,
      reason: parsed.data.reason || 'sent',
      contractorSignature,
      agreementUpdatedAt: estimate.updatedAt.toISOString(),
    },
  });
  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: isUpdateEmail ? 'estimate.email.updated' : 'estimate.email.sent',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: lead.id,
      email: lead.email,
      emailSendId: emailSend?.id,
      subject: renderedEmail.subject,
      templateKey: renderedEmail.templateKey,
      link: previewUrl,
      reason: parsed.data.reason || 'sent',
      contractorSignature,
      agreementUpdatedAt: estimate.updatedAt.toISOString(),
    },
  });

  return c.json({ data: { sent: true, to: lead.email, emailSendId: emailSend?.id ?? null, previewUrl } });
});

estimatesApp.post('/:id/portal-link', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate || estimate.orgId !== orgId) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  if (!lead || lead.orgId !== orgId) {
    return c.json({ error: 'Lead not found' }, 404);
  }
  
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await db.insert(portalTokens).values({
    leadId: lead.id,
    orgId,
    token,
    expiresAt,
  });
  
  const baseUrl = c.env.PUBLIC_URL || 'https://crewmodo.com';
  const link = `${baseUrl}/portal/${token}`;

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'estimate.portal_link.created',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: lead.id,
      expiresAt: expiresAt.toISOString(),
    },
  });
  
  return c.json({ data: { link, token, expiresAt } });
});

export default estimatesApp;
