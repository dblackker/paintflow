import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimates, leads, orgBranding, portalTokens } from '@paintflow/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail, estimateEmailTemplate } from '../lib/email';
import { createJobFromAcceptedEstimate, estimateContractValue } from '../lib/estimate-handoff';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const signSchema = z.object({
  name: z.string().min(1).max(255),
  signatureData: z.string().min(1).max(100000),
  packageName: z.string().optional(),
});

const estimatePackageSchema = z.object({
  name: z.string().min(1).max(100),
  subtotal: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().positive(),
  lineItems: z.array(z.unknown()).optional(),
});

const createEstimateSchema = z.object({
  leadId: z.string().uuid(),
  packages: z.array(estimatePackageSchema).min(1).max(5),
});

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
  
  const { name, signatureData, packageName } = parsed.data;
  
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
    signedBy: name,
    ipAddress: ip,
    userAgent,
  });
  
  return c.json({ data: { id: estimate.id, status: 'accepted', jobId: job.id } });
});

estimatesApp.use('*', authMiddleware);

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const db = createDb(c.env.DATABASE_URL);
  
  const data = await db.query.estimates.findMany({
    where: eq(estimates.orgId, orgId),
    orderBy: [desc(estimates.createdAt)],
    limit,
    offset,
  });
  
  return c.json({ data });
});

estimatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.errors }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  const recommendedPackage = parsed.data.packages.find((pkg) => /better|recommended/i.test(pkg.name))
    ?? parsed.data.packages[0];

  const [estimate] = await db.insert(estimates)
    .values({
      orgId,
      leadId: lead.id,
      packages: parsed.data.packages,
      total: Number(recommendedPackage.total).toFixed(2),
      status: 'sent',
      sentAt: new Date(),
    })
    .returning();

  await db.update(leads)
    .set({ status: 'estimate_sent', updatedAt: new Date() })
    .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));

  return c.json({
    data: {
      ...estimate,
      recommendedTotal: estimateContractValue(estimate),
    },
  }, 201);
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
  
  return c.json({ data: { link, token, expiresAt } });
});

export default estimatesApp;
