import { and, eq, sql } from 'drizzle-orm';
import type { createDb } from '@crewmodo/db';
import { emailSends, emailTemplates, jobs, leads, orgBranding, orgSettings, portalTokens } from '@crewmodo/db/schema';
import type { Env } from '../types';
import { renderInvoiceEmail, sendEmail } from './email';

type Db = ReturnType<typeof createDb>;

type InvoiceEmailInput = {
  idempotencyKey?: string;
  orgId: string;
  invoice: {
    id: string;
    leadId: string;
    estimateId?: string | null;
    jobId?: string | null;
    changeOrderId?: string | null;
    invoiceNumber: string;
    description: string;
    total: string | number;
    dueLabel?: string | null;
  };
  templateKey: 'invoice.quick.created' | 'invoice.deposit.created' | 'invoice.change_order.created' | 'invoice.payment.receipt' | 'invoice.payment.reminder' | 'invoice.canceled';
  payment?: {
    id?: string | null;
    amount: string | number;
    source?: string | null;
  } | null;
  balanceDue?: number | null;
  portalUrl?: string | null;
  sentBy?: string | null;
};

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function titleCase(value: string | null | undefined) {
  const text = String(value || '').replace(/_/g, ' ').trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : '';
}

function jobAddress(job?: typeof jobs.$inferSelect | null) {
  return [job?.streetAddress, job?.city, job?.state, job?.postalCode].filter(Boolean).join(', ');
}

async function latestPortalUrl(db: Db, env: Env, orgId: string, leadId: string) {
  const token = await db.query.portalTokens.findFirst({
    where: and(eq(portalTokens.orgId, orgId), eq(portalTokens.leadId, leadId)),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (!token || new Date() > token.expiresAt) {
    const nextToken = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await db.insert(portalTokens).values({ orgId, leadId, token: nextToken, expiresAt });
    return `${env.PUBLIC_URL || 'https://crewmodo.com'}/portal/${nextToken}`;
  }
  return `${env.PUBLIC_URL || 'https://crewmodo.com'}/portal/${token.token}`;
}

async function templateOverride(db: Db, orgId: string, templateKey: string) {
  return db.query.emailTemplates.findFirst({
    where: and(eq(emailTemplates.orgId, orgId), eq(emailTemplates.key, templateKey), eq(emailTemplates.isActive, true)),
  }).catch(() => null);
}

async function recordEmailSend(db: Db, values: typeof emailSends.$inferInsert) {
  const deliveryKey = (values.metadata as { deliveryKey?: string } | null)?.deliveryKey;
  async function existing() {
    return deliveryKey ? db.query.emailSends.findFirst({ where: and(eq(emailSends.orgId, values.orgId), sql`${emailSends.metadata}->>'deliveryKey'=${deliveryKey}`) }) : null;
  }
  try {
    const prior = await existing();
    if (prior) return prior;
    const [emailSend] = await db.insert(emailSends).values(values).returning();
    return emailSend;
  } catch (error) {
    const prior = await existing().catch(() => null);
    if (prior) return prior;
    if (deliveryKey) throw error;
    console.warn('Invoice email send logging unavailable; run email communications migration.', error);
    return null;
  }
}

export async function prepareInvoiceEmail(env: Env, db: Db, input: InvoiceEmailInput) {
  const [lead, branding, settings, job, override] = await Promise.all([
    db.query.leads.findFirst({ where: and(eq(leads.id, input.invoice.leadId), eq(leads.orgId, input.orgId)) }),
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, input.orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, input.orgId) }),
    input.invoice.jobId ? db.query.jobs.findFirst({ where: and(eq(jobs.id, input.invoice.jobId), eq(jobs.orgId, input.orgId)) }) : Promise.resolve(null),
    templateOverride(db, input.orgId, input.templateKey),
  ]);

  if (!lead?.email) return null;

  const basePortalUrl = await latestPortalUrl(db, env, input.orgId, input.invoice.leadId);
  const portalUrl = input.portalUrl || `${basePortalUrl}${basePortalUrl.includes('?') ? '&' : '?'}invoiceId=${input.invoice.id}`;
  const companyName = branding?.companyName || settings?.companyName || 'your contractor';
  const rendered = renderInvoiceEmail({
    templateKey: input.templateKey,
    leadName: lead.name || 'there',
    companyName,
    companyLogoUrl: branding?.logoUrl || null,
    estimatorEmail: settings?.email || null,
    estimatorPhone: settings?.phone || null,
    invoiceNumber: input.invoice.invoiceNumber,
    invoiceDescription: input.invoice.description,
    invoiceAmount: money(input.invoice.total),
    paymentAmount: input.payment ? money(input.payment.amount) : null,
    balanceDue: typeof input.balanceDue === 'number' ? money(input.balanceDue) : null,
    paymentSource: titleCase(input.payment?.source),
    jobName: job?.name || null,
    jobAddress: jobAddress(job),
    dueLabel: input.invoice.dueLabel || null,
    portalUrl,
  }, override);

  const log: typeof emailSends.$inferInsert = {
    orgId: input.orgId,
    leadId: lead.id,
    estimateId: input.invoice.estimateId || null,
    jobId: input.invoice.jobId || null,
    changeOrderId: input.invoice.changeOrderId || null,
    templateKey: rendered.templateKey,
    templateName: rendered.templateName,
    channel: rendered.channel,
    toEmail: lead.email,
    fromEmail: env.EMAIL_FROM || 'billing@crewmodo.com',
    replyTo: settings?.email || null,
    subject: rendered.subject,
    previewText: rendered.preheader,
    renderedHtml: rendered.html,
    renderedText: rendered.text,
    status: 'sent',
    provider: env.EMAIL_PROVIDER || (env.MAILCHANNELS_API_KEY ? 'mailchannels' : 'resend'),
    providerMessageId: null,
    sentBy: input.sentBy || null,
    metadata: {
      invoiceId: input.invoice.id,
      deliveryKey: input.idempotencyKey || null,
      paymentId: input.payment?.id || null,
      balanceDue: input.balanceDue ?? null,
      portalUrl,
    },
  };
  return { toEmail: lead.email, fromEmail: env.EMAIL_FROM || 'billing@crewmodo.com', fromName: env.EMAIL_FROM_NAME || '', replyTo: settings?.email || undefined, rendered, log };
}

export type PreparedInvoiceEmail = NonNullable<Awaited<ReturnType<typeof prepareInvoiceEmail>>>;

export async function sendPreparedInvoiceEmail(env: Env, db: Db, prepared: PreparedInvoiceEmail, idempotencyKey?: string) {
  const providerResult = await sendEmail({ ...env, EMAIL_FROM: prepared.fromEmail, EMAIL_FROM_NAME: prepared.fromName }, prepared.toEmail,
    prepared.rendered.subject, prepared.rendered.html, undefined, { replyTo: prepared.replyTo, text: prepared.rendered.text, idempotencyKey }) as { id?: string; message_id?: string };
  const emailSend = await recordEmailSend(db, { ...prepared.log, providerMessageId: providerResult?.id || providerResult?.message_id || null });

  return { sent: true, emailSendId: emailSend?.id ?? null };
}

export async function sendInvoiceEmail(env: Env, db: Db, input: InvoiceEmailInput) {
  const prepared = await prepareInvoiceEmail(env, db, input);
  return prepared ? sendPreparedInvoiceEmail(env, db, prepared, input.idempotencyKey) : { sent: false, emailSendId: null, reason: 'missing_customer_email' as const };
}
