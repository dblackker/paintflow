import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { auditLogs, estimates, leads, orgBranding, portalTokens } from '@paintflow/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail, estimateEmailTemplate } from '../lib/email';
import { createJobFromAcceptedEstimate, estimateContractValue } from '../lib/estimate-handoff';
import { createNotificationAndPush } from '../lib/web-push';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  
  return c.json({ 
    data: {
      id: estimate.id,
      packages: estimate.packages,
      total: estimate.total,
      status: estimate.status,
      createdAt: estimate.createdAt,
      signedName: estimate.signedName,
      signedAt: estimate.signedAt,
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
  
  const { name, signatureData, packageName, selectedOptions = [] } = parsed.data;
  
  const db = createDb(c.env.DATABASE_URL);
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const userAgent = c.req.header('User-Agent') || 'unknown';
  
  const [estimate] = await db.update(estimates)
    .set({
      signedName: name,
      signatureData,
      signedAt: new Date(),
      signedIp: ip,
      signedUserAgent: userAgent,
      status: 'accepted',
    })
    .where(eq(estimates.id, id))
    .returning();
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }

  const job = await createJobFromAcceptedEstimate(db, estimate, {
    packageName,
    selectedOptions: selectedOptionsForPackage(estimate, packageName, selectedOptions),
    signedBy: name,
    ipAddress: ip,
    userAgent,
  });

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  await createNotificationAndPush(c.env, {
    orgId: estimate.orgId,
    type: 'estimate.accepted',
    title: `Estimate accepted${lead?.name ? ` by ${lead.name}` : ''}`,
    body: `${name} accepted a ${estimateContractValue(estimate, packageName, selectedOptions).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} proposal.`,
    href: `/jobs/${job.id}`,
    priority: 'high',
    sourceType: 'estimate',
    sourceId: estimate.id,
    leadId: estimate.leadId,
    metadata: { jobId: job.id, signedBy: name, packageName },
  }).catch((err) => console.error('Push notification failed:', err));
  
  return c.json({ data: { id: estimate.id, status: 'accepted', jobId: job.id } });
});

estimatesApp.use('*', authMiddleware);

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
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
    leadName: leadsById.get(estimate.leadId)?.name ?? 'Customer',
    leadPhone: leadsById.get(estimate.leadId)?.phone,
    leadEmail: leadsById.get(estimate.leadId)?.email,
    leadStreetAddress: leadsById.get(estimate.leadId)?.streetAddress,
    leadCity: leadsById.get(estimate.leadId)?.city,
    leadState: leadsById.get(estimate.leadId)?.state,
    leadPostalCode: leadsById.get(estimate.leadId)?.postalCode,
  }));
  
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

  return c.json({ data: estimate });
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
  if (existing.status !== 'draft') {
    return c.json({ error: 'Only draft estimates can be edited' }, 409);
  }

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
  const now = new Date();

  const [estimate] = await db.update(estimates)
    .set({
      leadId: lead.id,
      packages: parsed.data.packages,
      total: estimateTotal,
      status: isDraft ? 'draft' : 'sent',
      sentAt: isDraft ? existing.sentAt : now,
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
    action: isDraft ? 'estimate.draft.updated' : 'estimate.sent',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: lead.id,
      packageCount: parsed.data.packages.length,
      total: estimate.total,
      source: 'draft_edit',
    },
  });

  return c.json({
    data: {
      ...estimate,
      recommendedTotal: estimateContractValue(estimate),
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

estimatesApp.post('/:id/send-email', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
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

  const branding = await db.query.orgBranding.findFirst({
    where: eq(orgBranding.orgId, orgId),
  });
  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';
  const total = estimateContractValue(estimate).toFixed(2);
  const html = estimateEmailTemplate({
    estimateId: estimate.id,
    leadName: lead.name,
    total,
    baseUrl,
    companyName: branding?.companyName || 'your painting contractor',
  });

  await sendEmail(c.env, lead.email, `Painting estimate from ${branding?.companyName || 'PaintFlow'}`, html);
  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'estimate.email.sent',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      leadId: lead.id,
      email: lead.email,
      link: `${baseUrl}/estimates/${estimate.id}`,
    },
  });

  return c.json({ data: { sent: true, to: lead.email } });
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
