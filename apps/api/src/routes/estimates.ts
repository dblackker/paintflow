import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { auditLogs, customerPayments, emailSends, emailTemplates, estimatePhotos, estimates, leads, orgBranding, orgSettings, portalTokens, users } from '@paintflow/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail, renderEstimateEmail } from '../lib/email';
import { estimateContractValue } from '../lib/estimate-handoff';
import { estimatePaymentSchedule } from '../lib/payment-schedule';
import { legalSettingsFromPreferences, readPreferenceObject } from '../lib/legal-settings';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
const CLIENT_VIEW_THROTTLE_MS = 30 * 60 * 1000;
const CONTRACTOR_SIGNATURE_ACTIONS = ['estimate.email.sent', 'estimate.email.updated', 'estimate.contractor.countersigned'];

const selectedOptionSchema = z.object({
  desc: z.string().trim().min(1).max(500),
  qty: z.coerce.number().positive().default(1),
  rate: z.coerce.number().nonnegative(),
  category: z.string().trim().max(120).optional(),
});

const signSchema = z.object({
  name: z.string().min(1).max(255),
  signatureData: z.string().min(1).max(100000),
  packageName: z.string().optional(),
  selectedOptions: z.array(selectedOptionSchema).max(20).optional(),
  acknowledgedDisclosure: z.boolean().optional(),
});

const estimateLineItemSchema = z.object({
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

const createEstimateSchema = z.object({
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

const cancelEstimateSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const agreementActionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const sendEstimateEmailSchema = z.object({
  reason: z.enum(['sent', 'updated']).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  preheader: z.string().trim().max(300).optional(),
  html: z.string().trim().min(1).max(50000).optional(),
  text: z.string().trim().max(10000).optional(),
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
  const allowed = new Map(optionalItems
    .filter((item) => item.optional && item.customerVisible !== false)
    .map((item) => [`${item.desc}|${Number(item.qty || 1)}|${Number(item.rate || 0)}`, item]));

  return selectedOptions
    .map((option) => allowed.get(`${option.desc}|${Number(option.qty || 1)}|${Number(option.rate || 0)}`))
    .filter((option): option is NonNullable<typeof option> => Boolean(option))
    .map((option) => ({
      desc: String(option.desc),
      qty: Number(option.qty || 1),
      rate: Number(option.rate || 0),
      category: option.category,
    }));
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
  const legal = legalSettingsFromPreferences(readPreferenceObject(settings?.businessHours));

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
  const paymentSchedule = estimatePaymentSchedule(settings || {}, total, paidAmount);
  const contractorSignature = await estimateContractorSignature(db, estimate);
  await recordPublicEstimateView(db, c, estimate);
  
  return c.json({ 
    data: {
      id: estimate.id,
      ...estimateJobsite(estimate),
      packages: estimate.packages,
      total: estimate.total,
      status: estimate.status,
      createdAt: estimate.createdAt,
      updatedAt: estimate.updatedAt,
      sentAt: estimate.sentAt,
      signedName: estimate.signedName,
      signedAt: estimate.signedAt,
      contractorSignature,
      paymentSummary: {
        paidAmount: Math.max(paidAmount, 0),
        paymentCount: payments.length,
        balanceDue: Math.max(total - paidAmount, 0),
      },
      paymentSchedule,
      paymentTerms: settings?.paymentTerms || 'Due on completion',
      legal,
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
  if (existing.status === 'canceled') {
    return c.json({ error: 'This estimate has been canceled' }, 409);
  }
  if (['superseded', 'voided'].includes(existing.status)) {
    return c.json({ error: 'This estimate agreement is no longer active' }, 409);
  }
  if (existing.status === 'accepted') {
    return c.json({ error: 'This estimate has already been accepted' }, 409);
  }
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
  const legal = legalSettingsFromPreferences(readPreferenceObject(settings?.businessHours));
  if (legal.disclosureEnabled && legal.disclosureRequired && !acknowledgedDisclosure) {
    return c.json({ error: 'Please acknowledge the required disclosure before signing.' }, 400);
  }
  
  const [estimate] = await db.update(estimates)
    .set({
      signedName: name,
      signatureData,
      signedAt: new Date(),
      signedIp: ip,
      signedUserAgent: userAgent,
      updatedAt: new Date(),
    })
    .where(eq(estimates.id, id))
    .returning();

  const cleanOptions = selectedOptionsForPackage(estimate, packageName, selectedOptions);
  await db.insert(auditLogs).values({
    orgId: estimate.orgId,
    action: 'estimate.signed',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      packageName: packageName ?? null,
      contractValue: estimateContractValue(estimate, packageName, cleanOptions),
      selectedOptions: cleanOptions,
      awaitingPayment: true,
      contractorSignature,
      legalSnapshot: legal,
      acknowledgedDisclosure: Boolean(legal.disclosureEnabled && acknowledgedDisclosure),
    },
    ipAddress: ip,
    userAgent,
  });
  
  return c.json({ data: { id: estimate.id, status: estimate.status, signedAt: estimate.signedAt, awaitingPayment: true } });
});

estimatesApp.use('*', authMiddleware);

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  const isDraft = parsed.data.status === 'draft';
  const recommendedPackage = parsed.data.packages.find((pkg) => /better|recommended/i.test(pkg.name))
    ?? parsed.data.packages[0];
  const estimateTotal = recommendedPackage ? Number(recommendedPackage.total).toFixed(2) : '0.00';

  const [estimate] = await db.insert(estimates)
    .values({
      orgId,
      leadId: lead.id,
      streetAddress: parsed.data.streetAddress || lead.streetAddress,
      city: parsed.data.city || lead.city,
      state: parsed.data.state || lead.state,
      postalCode: parsed.data.postalCode || lead.postalCode,
      packages: parsed.data.packages,
      total: estimateTotal,
      status: isDraft ? 'draft' : 'sent',
      sentAt: isDraft ? null : new Date(),
    })
    .returning();

  if (!isDraft) {
    await db.update(leads)
      .set({ status: 'estimate_sent', updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));
  }

  const auditEntries: Array<typeof auditLogs.$inferInsert> = [
    {
      orgId,
      userId: c.get('userId'),
      action: 'estimate.created',
      entityType: 'estimate',
      entityId: estimate.id,
      metadata: {
        leadId: lead.id,
        packageCount: parsed.data.packages.length,
        total: estimate.total,
      },
    },
  ];

  if (isDraft) {
    auditEntries.push({
      orgId,
      userId: c.get('userId'),
      action: 'estimate.draft.saved',
      entityType: 'estimate',
      entityId: estimate.id,
      metadata: {
        leadId: lead.id,
        packageCount: parsed.data.packages.length,
        total: estimate.total,
      },
    });
  } else {
    auditEntries.push(
    {
      orgId,
      userId: c.get('userId'),
      action: 'estimate.sent',
      entityType: 'estimate',
      entityId: estimate.id,
      metadata: {
        leadId: lead.id,
        channel: 'in_app',
        total: estimate.total,
      },
    },
    );
  }

  await db.insert(auditLogs).values(auditEntries);

  return c.json({
    data: {
      ...estimate,
      recommendedTotal: estimateContractValue(estimate),
      publicUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id),
      customerPreviewUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id),
    },
  }, 201);
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

  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
  const payments = await optionalPaymentRows(db.select().from(customerPayments)
    .where(and(eq(customerPayments.orgId, orgId), eq(customerPayments.estimateId, estimate.id)))
    .orderBy(desc(customerPayments.receivedAt)));
  const contractorSignature = await estimateContractorSignature(db, estimate);
  return c.json({ data: { ...estimate, payments, contractorSignature, publicUrl: publicEstimateUrl(baseUrl, estimate.id), customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id) } });
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
    return c.json({ data: { ...estimate, publicUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id), customerPreviewUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id) } });
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

  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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
    const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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

  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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

  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
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

  const isDraft = existing.status === 'draft' && parsed.data.status === 'draft';
  const isUpdatingSent = existing.status === 'sent';
  const recommendedPackage = parsed.data.packages.find((pkg) => /better|recommended/i.test(pkg.name))
    ?? parsed.data.packages[0];
  const estimateTotal = recommendedPackage ? Number(recommendedPackage.total).toFixed(2) : '0.00';
  const now = new Date();

  const [estimate] = await db.update(estimates)
    .set({
      leadId: lead.id,
      streetAddress: parsed.data.streetAddress || lead.streetAddress,
      city: parsed.data.city || lead.city,
      state: parsed.data.state || lead.state,
      postalCode: parsed.data.postalCode || lead.postalCode,
      packages: parsed.data.packages,
      total: estimateTotal,
      status: isDraft ? 'draft' : 'sent',
      sentAt: isDraft ? existing.sentAt : (existing.sentAt || now),
      updatedAt: now,
    })
    .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)))
    .returning();

  if (!isDraft) {
    await db.update(leads)
      .set({ status: 'estimate_sent', updatedAt: now })
      .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));
  }

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: isDraft ? 'estimate.draft.updated' : isUpdatingSent ? 'estimate.updated' : 'estimate.sent',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: lead.id,
      packageCount: parsed.data.packages.length,
      total: estimate.total,
      previousTotal: existing.total,
      previousStatus: existing.status,
      source: isUpdatingSent ? 'sent_estimate_edit' : 'draft_edit',
    },
  });

  return c.json({
    data: {
      ...estimate,
      recommendedTotal: estimateContractValue(estimate),
      publicUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id),
      customerPreviewUrl: publicEstimateUrl(c.env.PUBLIC_URL || 'https://app.paintflow.app', estimate.id),
    },
  });
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

async function renderEstimateEmailPreview(
  db: ReturnType<typeof createDb>,
  env: Env,
  orgId: string,
  id: string,
  userId?: string,
  reason?: 'sent' | 'updated'
) {
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, id), eq(estimates.orgId, orgId)),
  });
  if (!estimate) return null;

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, estimate.leadId), eq(leads.orgId, orgId)),
  });
  if (!lead) return null;

  const [branding, settings] = await Promise.all([
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  const estimator = userId
    ? await db.query.users.findFirst({ where: eq(users.id, userId) })
    : null;
  const baseUrl = env.PUBLIC_URL || 'https://app.paintflow.app';
  const total = estimateContractValue(estimate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const projectType = estimateProjectType(estimate);
  const isUpdateEmail = reason === 'updated';
  const templateKey = isUpdateEmail ? 'estimate.updated.sent' : estimateEmailTemplateKey(projectType);
  const signerName = estimator?.name || estimator?.email || settings?.companyName || branding?.companyName || 'Authorized representative';
  const templateOverride = await findEmailTemplateOverride(db, orgId, templateKey);
  const renderedEmail = renderEstimateEmail({
    estimateId: estimate.id,
    leadName: lead.name,
    total,
    baseUrl,
    companyName: branding?.companyName || settings?.companyName || 'your painting contractor',
    estimatorName: signerName,
    estimatorEmail: settings?.email || estimator?.email || null,
    estimatorPhone: settings?.phone || null,
    estimateType: projectType,
    scopeSummary: proposalScopeSummary(estimate),
    isUpdate: isUpdateEmail,
  }, templateOverride);

  return {
    estimate,
    lead,
    settings,
    estimator,
    renderedEmail,
    projectType,
    previewUrl: publicEstimateUrl(baseUrl, estimate.id),
  };
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
    const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
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
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
  return c.json({
    data: {
      contractorSignature,
      alreadySigned: false,
      publicUrl: publicEstimateUrl(baseUrl, estimate.id),
      customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id),
    },
  });
});

estimatesApp.post('/:id/email-preview', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = sendEstimateEmailSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid email request', details: parsed.error.flatten() }, 400);
  }
  const db = createDb(c.env.DATABASE_URL);
  const preview = await renderEstimateEmailPreview(db, c.env, orgId, id, c.get('userId'), parsed.data.reason);
  if (!preview) return c.json({ error: 'Estimate or customer not found' }, 404);

  return c.json({
    data: {
      to: preview.lead.email || null,
      previewUrl: preview.previewUrl,
      subject: preview.renderedEmail.subject,
      preheader: preview.renderedEmail.preheader,
      html: preview.renderedEmail.html,
      text: preview.renderedEmail.text,
      templateKey: preview.renderedEmail.templateKey,
      templateName: preview.renderedEmail.templateName,
      estimate: preview.estimate,
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
  const userId = c.get('userId');
  const preview = await renderEstimateEmailPreview(db, c.env, orgId, id, userId, parsed.data.reason);
  if (!preview) return c.json({ error: 'Estimate or customer not found' }, 404);
  const { estimate, lead, settings, estimator, renderedEmail, projectType, previewUrl } = preview;

  if (!lead?.email) {
    return c.json({ error: 'Lead email is required before sending an estimate' }, 400);
  }

  const isUpdateEmail = parsed.data.reason === 'updated';
  const contractorSignature = await buildContractorSignature(db, orgId, userId);
  const emailToSend = {
    ...renderedEmail,
    subject: parsed.data.subject || renderedEmail.subject,
    preheader: parsed.data.preheader ?? renderedEmail.preheader,
    html: parsed.data.html || renderedEmail.html,
    text: parsed.data.text || renderedEmail.text,
  };
  const fromEmail = c.env.EMAIL_FROM || 'estimates@paintflow.app';
  const replyTo = settings?.email || estimator?.email || undefined;

  const providerResult = await sendEmail(c.env, lead.email, emailToSend.subject, emailToSend.html, undefined, {
    replyTo,
    text: emailToSend.text,
  }) as { id?: string; message_id?: string };
  if (estimate.status === 'draft') {
    await db.update(estimates)
      .set({ status: 'sent', sentAt: estimate.sentAt || new Date(), updatedAt: new Date() })
      .where(and(eq(estimates.id, estimate.id), eq(estimates.orgId, orgId)));
    await db.update(leads)
      .set({ status: 'estimate_sent', updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));
  }
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
    subject: emailToSend.subject,
    previewText: emailToSend.preheader,
    renderedHtml: emailToSend.html,
    renderedText: emailToSend.text,
    status: 'sent',
    provider: c.env.EMAIL_PROVIDER || (c.env.MAILCHANNELS_API_KEY ? 'mailchannels' : 'resend'),
    providerMessageId: providerResult?.id || providerResult?.message_id || null,
    sentBy: c.get('userId'),
    metadata: {
      estimateType: projectType,
      link: previewUrl,
      reason: parsed.data.reason || 'sent',
      contractorSignature,
      editedBeforeSend: Boolean(parsed.data.subject || parsed.data.preheader || parsed.data.html || parsed.data.text),
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
      subject: emailToSend.subject,
      templateKey: renderedEmail.templateKey,
      link: previewUrl,
      reason: parsed.data.reason || 'sent',
      contractorSignature,
      editedBeforeSend: Boolean(parsed.data.subject || parsed.data.preheader || parsed.data.html || parsed.data.text),
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
  
  const baseUrl = c.env.PUBLIC_URL || 'https://paintflow.app';
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
