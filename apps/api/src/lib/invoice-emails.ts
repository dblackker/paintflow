import { and, eq } from 'drizzle-orm';
import type { createDb } from '@crewmodo/db';
import { emailSends, emailTemplates, jobs, leads, orgBranding, orgSettings, portalTokens } from '@crewmodo/db/schema';
import type { Env } from '../types';
import { renderInvoiceEmail, sendEmail } from './email';

type Db = ReturnType<typeof createDb>;

type InvoiceEmailInput = {
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
  templateKey: 'invoice.quick.created' | 'invoice.deposit.created' | 'invoice.change_order.created' | 'invoice.payment.receipt' | 'invoice.payment.reminder';
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
  try {
    const [emailSend] = await db.insert(emailSends).values(values).returning();
    return emailSend;
  } catch (error) {
    console.warn('Invoice email send logging unavailable; run email communications migration.', error);
    return null;
  }
}

export async function sendInvoiceEmail(env: Env, db: Db, input: InvoiceEmailInput) {
  const [lead, branding, settings, job, override] = await Promise.all([
    db.query.leads.findFirst({ where: and(eq(leads.id, input.invoice.leadId), eq(leads.orgId, input.orgId)) }),
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, input.orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, input.orgId) }),
    input.invoice.jobId ? db.query.jobs.findFirst({ where: and(eq(jobs.id, input.invoice.jobId), eq(jobs.orgId, input.orgId)) }) : Promise.resolve(null),
    templateOverride(db, input.orgId, input.templateKey),
  ]);

  if (!lead?.email) return { sent: false, reason: 'missing_customer_email' as const };

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

  const providerResult = await sendEmail(env, lead.email, rendered.subject, rendered.html, undefined, {
    replyTo: settings?.email || undefined,
    text: rendered.text,
  }) as { id?: string; message_id?: string };

  const emailSend = await recordEmailSend(db, {
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
    providerMessageId: providerResult?.id || providerResult?.message_id || null,
    sentBy: input.sentBy || null,
    metadata: {
      invoiceId: input.invoice.id,
      paymentId: input.payment?.id || null,
      balanceDue: input.balanceDue ?? null,
      portalUrl,
    },
  });

  return { sent: true, emailSendId: emailSend?.id ?? null };
}
