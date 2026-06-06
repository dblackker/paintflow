import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { auditLogs, changeOrders, emailSends, emailTemplates, jobs, leads, orgBranding, orgSettings, portalTokens, users } from '@crewmodo/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { renderChangeOrderEmail, sendEmail } from '../lib/email';

const changeOrdersRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
changeOrdersRoute.use('*', authMiddleware);

const scopeItemSchema = z.object({
  area: z.string().trim().max(120).optional().nullable(),
  substrate: z.string().trim().max(120).optional().nullable(),
  prep: z.string().trim().max(120).optional().nullable(),
  applicationMethod: z.string().trim().max(120).optional().nullable(),
  paintProduct: z.string().trim().max(180).optional().nullable(),
  color: z.string().trim().max(120).optional().nullable(),
  coats: z.coerce.number().min(1).max(3).optional().nullable(),
  quantity: z.coerce.number().min(0).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const scopeDetailsSchema = z.object({
  items: z.array(scopeItemSchema).max(30).default([]),
}).optional();

const changeOrderSchema = z.object({
  jobId: z.string().uuid(),
  estimateId: z.string().uuid(),
  description: z.string().trim().max(2000).optional(),
  scopeDetails: scopeDetailsSchema,
  amount: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'pending', 'approved', 'rejected', 'completed', 'canceled']).default('pending'),
  createdBy: z.enum(['contractor', 'customer']).default('contractor'),
  paymentRequired: z.coerce.boolean().default(false),
  depositPercent: z.coerce.number().min(0).max(100).default(100),
}).superRefine((data, ctx) => {
  if (data.status === 'draft') return;
  if (!data.description?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Description is required before sending a change order.' });
  }
  if (data.amount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Amount must be greater than zero before sending a change order.' });
  }
});

const updateChangeOrderSchema = z.object({
  description: z.string().trim().max(2000).optional(),
  scopeDetails: scopeDetailsSchema,
  amount: z.coerce.number().min(0).optional(),
  status: z.enum(['draft', 'pending', 'approved', 'rejected', 'completed', 'canceled']).optional(),
  createdBy: z.enum(['contractor', 'customer']).optional(),
  paymentRequired: z.coerce.boolean().optional(),
  depositPercent: z.coerce.number().min(0).max(100).optional(),
  paymentStatus: z.enum(['not_requested', 'pending', 'paid', 'waived']).optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

function paymentDueAmount(amount: number, paymentRequired: boolean, depositPercent: number) {
  return paymentRequired ? Math.round(amount * (depositPercent / 100) * 100) / 100 : null;
}

function customerFacingValidation(description: unknown, amount: unknown) {
  const errors: string[] = [];
  if (!String(description || '').trim()) errors.push('Description is required before sending a change order.');
  if (Number(amount || 0) <= 0) errors.push('Amount must be greater than zero before sending a change order.');
  return errors;
}

function portalToken() {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  return Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paymentSchedule(order: typeof changeOrders.$inferSelect) {
  if (!order.paymentRequired) return 'No online payment is required at approval.';
  const due = money(order.paymentDueAmount || order.amount);
  const percent = Number(order.depositPercent || 100);
  if (percent >= 100) return `100% due after approval: $${due}.`;
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 2 })}% due after approval: $${due}. Remaining balance is due according to the job payment schedule.`;
}

function jobAddress(job: typeof jobs.$inferSelect, lead: typeof leads.$inferSelect) {
  return [
    job.streetAddress || lead.streetAddress,
    job.city || lead.city,
    job.state || lead.state,
    job.postalCode || lead.postalCode,
  ].filter(Boolean).join(', ');
}

function jobDisplayName(job: typeof jobs.$inferSelect) {
  return [job.jobNumber, job.name].filter(Boolean).join(' - ');
}

async function contractorSignature(db: ReturnType<typeof createDb>, orgId: string, userId?: string) {
  const [branding, settings, signer] = await Promise.all([
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
    userId ? db.query.users.findFirst({ where: eq(users.id, userId) }) : Promise.resolve(null),
  ]);
  const companyName = branding?.companyName || settings?.companyName || 'the painting company';
  const name = signer?.name || signer?.email || settings?.companyName || branding?.companyName || 'Authorized representative';
  return {
    name,
    email: signer?.email || settings?.email || null,
    title: 'Authorized representative',
    companyName,
    capacity: `Authorized representative for ${companyName}`,
    signedAt: new Date().toISOString(),
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
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function recordEmailSend(db: ReturnType<typeof createDb>, values: typeof emailSends.$inferInsert) {
  try {
    const [emailSend] = await db.insert(emailSends).values(values).returning();
    return emailSend;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function createPortalLink(db: ReturnType<typeof createDb>, orgId: string, id: string) {
  const order = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)),
  });
  if (!order) return null;
  if (order.status === 'draft' || order.status === 'canceled') return null;

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, orgId)),
  });
  if (!job) return null;

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, job.leadId), eq(leads.orgId, orgId)),
  });
  if (!lead) return null;

  const token = portalToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await db.insert(portalTokens).values({ leadId: lead.id, orgId, token, expiresAt });

  return { order, job, lead, token, expiresAt };
}

async function renderChangeOrderEmailPreview(
  db: ReturnType<typeof createDb>,
  env: Env,
  orgId: string,
  id: string,
  userId?: string
) {
  const portal = await createPortalLink(db, orgId, id);
  if (!portal) return null;

  const [branding, settings] = await Promise.all([
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  const estimator = userId ? await db.query.users.findFirst({ where: eq(users.id, userId) }) : null;
  const baseUrl = env.PUBLIC_URL || 'https://crewmodo.com';
  const portalUrl = `${baseUrl}/portal/${portal.token}?changeOrderId=${id}`;
  const templateKey = 'change_order.approval.sent';
  const templateOverride = await findEmailTemplateOverride(db, orgId, templateKey);
  const renderedEmail = renderChangeOrderEmail({
    leadName: portal.lead.name,
    companyName: branding?.companyName || settings?.companyName || 'your painting contractor',
    estimatorName: estimator?.name || estimator?.email || settings?.companyName || branding?.companyName,
    estimatorEmail: settings?.email || estimator?.email || null,
    estimatorPhone: settings?.phone || null,
    jobName: jobDisplayName(portal.job),
    jobAddress: jobAddress(portal.job, portal.lead),
    description: portal.order.description,
    amount: money(portal.order.amount),
    paymentRequired: Boolean(portal.order.paymentRequired),
    paymentDue: portal.order.paymentRequired ? money(portal.order.paymentDueAmount || portal.order.amount) : null,
    paymentSchedule: paymentSchedule(portal.order),
    portalUrl,
  }, templateOverride);

  return {
    ...portal,
    portalUrl,
    renderedEmail,
    settings,
    estimator,
  };
}

// GET /v1/change-orders?jobId=xxx
changeOrdersRoute.get('/', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  const where = jobId
    ? and(eq(changeOrders.orgId, orgId), eq(changeOrders.jobId, jobId))
    : eq(changeOrders.orgId, orgId);
  
  const data = await db.select().from(changeOrders).where(where).orderBy(desc(changeOrders.createdAt));
  return c.json({ data });
});

// POST /v1/change-orders
changeOrdersRoute.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = changeOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)),
  });
  if (!job || job.estimateId !== data.estimateId) {
    return c.json({ error: 'Job not found for estimate' }, 404);
  }

  const [order] = await db.insert(changeOrders).values({
    jobId: data.jobId,
    estimateId: data.estimateId,
    description: data.description?.trim() || 'Draft change order',
    scopeDetails: data.scopeDetails || null,
    status: data.status,
    createdBy: data.createdBy,
    paymentRequired: data.paymentRequired,
    orgId,
    amount: data.amount.toFixed(2),
    depositPercent: data.depositPercent.toFixed(2),
    paymentDueAmount: paymentDueAmount(data.amount, data.paymentRequired, data.depositPercent)?.toFixed(2) ?? null,
    paymentStatus: data.paymentRequired ? 'pending' : 'not_requested',
    approvedAt: data.status === 'approved' ? new Date() : undefined,
    contractorSignature: data.status === 'draft' ? null : await contractorSignature(db, orgId, c.get('userId')),
  }).returning();

  const portal = order.status === 'draft' ? null : await createPortalLink(db, orgId, order.id);
  const baseUrl = c.env.PUBLIC_URL || 'https://crewmodo.com';
  return c.json({ data: { ...order, approvalLink: portal ? `${baseUrl}/portal/${portal.token}?changeOrderId=${order.id}` : null } });
});

changeOrdersRoute.post('/:id/portal-link', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const portal = await createPortalLink(db, orgId, id);
  if (!portal) return c.json({ error: 'Change order is not ready for a customer approval link.' }, 409);

  const [updated] = await db.update(changeOrders)
    .set({
      sentAt: new Date(),
      contractorSignature: await contractorSignature(db, orgId, c.get('userId')),
    })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'change_order.portal_link.created',
    entityType: 'change_order',
    entityId: id,
    metadata: {
      jobId: portal.job.id,
      jobNumber: portal.job.jobNumber,
      leadId: portal.lead.id,
      expiresAt: portal.expiresAt.toISOString(),
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://crewmodo.com';
  return c.json({ data: { link: `${baseUrl}/portal/${portal.token}?changeOrderId=${id}`, token: portal.token, expiresAt: portal.expiresAt, changeOrder: updated } });
});

changeOrdersRoute.post('/:id/email-preview', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const preview = await renderChangeOrderEmailPreview(db, c.env, orgId, id, c.get('userId'));
  if (!preview) return c.json({ error: 'Change order is not ready to preview. Save it as ready for approval first.' }, 409);

  return c.json({
    data: {
      to: preview.lead.email || null,
      link: preview.portalUrl,
      expiresAt: preview.expiresAt,
      subject: preview.renderedEmail.subject,
      preheader: preview.renderedEmail.preheader,
      html: preview.renderedEmail.html,
      text: preview.renderedEmail.text,
      templateKey: preview.renderedEmail.templateKey,
      templateName: preview.renderedEmail.templateName,
      paymentSchedule: paymentSchedule(preview.order),
      changeOrder: preview.order,
    },
  });
});

changeOrdersRoute.post('/:id/send-email', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const userId = c.get('userId');
  const preview = await renderChangeOrderEmailPreview(db, c.env, orgId, id, userId);
  if (!preview) return c.json({ error: 'Change order is not ready to send. Save it as ready for approval first.' }, 409);
  if (!preview.lead.email) return c.json({ error: 'Customer email is required before sending a change order' }, 400);

  const countersignature = await contractorSignature(db, orgId, userId);
  const replyTo = preview.settings?.email || preview.estimator?.email || undefined;
  const providerResult = await sendEmail(c.env, preview.lead.email, preview.renderedEmail.subject, preview.renderedEmail.html, undefined, {
    replyTo,
    text: preview.renderedEmail.text,
  }) as { id?: string; message_id?: string };
  const [updatedOrder] = await db.update(changeOrders)
    .set({
      sentAt: new Date(),
      contractorSignature: countersignature,
    })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();
  const emailSend = await recordEmailSend(db, {
    orgId,
    leadId: preview.lead.id,
    estimateId: preview.order.estimateId,
    jobId: preview.job.id,
    changeOrderId: preview.order.id,
    templateKey: preview.renderedEmail.templateKey,
    templateName: preview.renderedEmail.templateName,
    channel: preview.renderedEmail.channel,
    toEmail: preview.lead.email,
    fromEmail: c.env.EMAIL_FROM || 'estimates@crewmodo.com',
    replyTo: replyTo || null,
    subject: preview.renderedEmail.subject,
    previewText: preview.renderedEmail.preheader,
    renderedHtml: preview.renderedEmail.html,
    renderedText: preview.renderedEmail.text,
    status: 'sent',
    provider: c.env.EMAIL_PROVIDER || (c.env.MAILCHANNELS_API_KEY ? 'mailchannels' : 'resend'),
    providerMessageId: providerResult?.id || providerResult?.message_id || null,
    sentBy: c.get('userId'),
    metadata: {
      link: preview.portalUrl,
      amount: preview.order.amount,
      jobNumber: preview.job.jobNumber,
      paymentRequired: preview.order.paymentRequired,
      paymentSchedule: paymentSchedule(preview.order),
      expiresAt: preview.expiresAt.toISOString(),
      contractorSignature: countersignature,
    },
  });

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'change_order.email.sent',
    entityType: 'change_order',
    entityId: id,
    metadata: {
      jobId: preview.job.id,
      jobNumber: preview.job.jobNumber,
      leadId: preview.lead.id,
      email: preview.lead.email,
      emailSendId: emailSend?.id,
      subject: preview.renderedEmail.subject,
      templateKey: preview.renderedEmail.templateKey,
      link: preview.portalUrl,
      expiresAt: preview.expiresAt.toISOString(),
      contractorSignature: countersignature,
    },
  });

  return c.json({ data: { sent: true, to: preview.lead.email, emailSendId: emailSend?.id ?? null, link: preview.portalUrl, changeOrder: updatedOrder } });
});

// PATCH /v1/change-orders/:id
changeOrdersRoute.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateChangeOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  const existing = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)),
  });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  const nextAmount = data.amount ?? Number(existing.amount);
  const nextDescription = data.description ?? existing.description;
  const nextStatus = data.status ?? existing.status;
  if (nextStatus !== 'draft' && nextStatus !== 'canceled') {
    const readyErrors = customerFacingValidation(nextDescription, nextAmount);
    if (readyErrors.length) {
      return c.json({ error: readyErrors[0], details: { formErrors: readyErrors } }, 400);
    }
  }

  const nextPaymentRequired = data.paymentRequired ?? Boolean(existing.paymentRequired);
  const nextDepositPercent = data.depositPercent ?? Number(existing.depositPercent || 100);
  const update: Record<string, unknown> = {
    ...data,
    reason: undefined,
    amount: data.amount == null ? undefined : data.amount.toFixed(2),
    depositPercent: data.depositPercent == null ? undefined : data.depositPercent.toFixed(2),
    paymentDueAmount: paymentDueAmount(nextAmount, nextPaymentRequired, nextDepositPercent)?.toFixed(2) ?? null,
  };

  if (data.paymentRequired !== undefined || data.depositPercent !== undefined || data.amount !== undefined) {
    update.paymentStatus = nextPaymentRequired ? (existing.paymentStatus === 'paid' ? 'paid' : 'pending') : 'not_requested';
  }

  if (existing.status === 'draft' && nextStatus !== 'draft') {
    update.contractorSignature = await contractorSignature(db, orgId, c.get('userId'));
  }

  if (data.status === 'approved' && !existing.approvedAt) {
    if (!existing.customerSignedAt) {
      return c.json({ error: 'Customer signature is required before marking a change order approved. Send the portal link or use the customer portal approval flow.' }, 409);
    }
    update.approvedAt = new Date();
    update.approvedBy = 'contractor';
  }

  if (data.status === 'canceled') {
    if (['approved', 'completed'].includes(existing.status) || existing.paymentStatus === 'paid') {
      return c.json({ error: 'Approved, completed, or paid change orders cannot be canceled. Use a credit/refund workflow instead.' }, 409);
    }
    update.canceledAt = new Date();
    update.canceledReason = data.reason || 'Canceled from job detail';
  }
  
  const [order] = await db.update(changeOrders)
    .set(update)
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();

  if (data.status && data.status !== existing.status) {
    await db.insert(auditLogs).values({
      orgId,
      userId: c.get('userId'),
      action: `change_order.${data.status}`,
      entityType: 'change_order',
      entityId: id,
      metadata: {
        jobId: order.jobId,
        estimateId: order.estimateId,
        amount: order.amount,
        previousStatus: existing.status,
      },
    });
  }
  
  return c.json({ data: order });
});

export default changeOrdersRoute;
