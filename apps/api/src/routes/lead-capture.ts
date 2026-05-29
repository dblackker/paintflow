import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { activities, auditLogs, leads, leadSources, notificationEvents, organizations } from '@crewmodo/db/schema';
import { and, eq, or } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { formatPhoneNumber } from '../lib/twilio';

const leadCaptureRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const captureSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional(),
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().email().max(255).optional(),
  ),
  streetAddress: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(100).optional(),
  sourceType: z.string().trim().max(50).optional(),
  referrer: z.string().trim().max(500).optional(),
  landingPage: z.string().trim().max(500).optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
  website: z.string().trim().max(255).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
  company: z.string().trim().max(255).optional(), // Honeypot. Real users should leave this empty.
}).refine((value) => value.phone || value.email, {
  message: 'A phone number or email is required',
  path: ['phone'],
});

function normalizePhone(phone?: string) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return undefined;
  try {
    return formatPhoneNumber(phone);
  } catch {
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }
}

function normalizeEmail(email?: string) {
  return email?.trim().toLowerCase() || undefined;
}

function clientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function sourceName(input: z.infer<typeof captureSchema>) {
  return input.source || input.utmSource || 'Website';
}

function sourceType(input: z.infer<typeof captureSchema>) {
  return input.sourceType || (input.utmMedium ? `utm:${input.utmMedium}` : 'website');
}

function metadataFor(input: z.infer<typeof captureSchema>, request: Request) {
  return {
    message: input.message || null,
    referrer: input.referrer || request.headers.get('Referer') || null,
    landingPage: input.landingPage || null,
    website: input.website || null,
    utm: {
      source: input.utmSource || null,
      medium: input.utmMedium || null,
      campaign: input.utmCampaign || null,
    },
  };
}

async function rateLimit(c: Context<{ Bindings: Env; Variables: Variables }>, orgSlug: string) {
  const ip = clientIp(c.req.raw);
  const minuteKey = `lead-capture:${orgSlug}:${ip}:${Math.floor(Date.now() / 60000)}`;
  const current = Number(await c.env.KV.get(minuteKey) || 0);
  if (current >= 5) return false;
  await c.env.KV.put(minuteKey, String(current + 1), { expirationTtl: 120 });
  return true;
}

leadCaptureRoute.post('/:orgSlug', async (c) => {
  const orgSlug = c.req.param('orgSlug');
  if (!await rateLimit(c, orgSlug)) {
    return c.json({ error: 'Too many lead submissions. Please try again shortly.' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = captureSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.company) {
    return c.json({ data: { accepted: true } }, 202);
  }

  const db = createDb(c.env.DATABASE_URL);
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });

  if (!org) {
    return c.json({ error: 'Lead capture destination not found' }, 404);
  }

  const phone = normalizePhone(parsed.data.phone);
  const email = normalizeEmail(parsed.data.email);
  if (parsed.data.phone && !phone && !email) {
    return c.json({ error: 'Validation failed', details: { fieldErrors: { phone: ['Enter a valid phone number or include an email address.'] } } }, 400);
  }

  const submittedIdempotencyKey = c.req.header('Idempotency-Key')?.trim() || parsed.data.idempotencyKey;
  const idempotencyKey = submittedIdempotencyKey
    ? `lead-capture:idempotency:${org.id}:${submittedIdempotencyKey}`
    : null;
  if (idempotencyKey) {
    const cached = await c.env.KV.get(idempotencyKey, 'json') as { status: number; payload: unknown } | null;
    if (cached) return c.json(cached.payload, cached.status as 200 | 201 | 202);
  }

  const source = sourceName(parsed.data);
  const metadata = metadataFor(parsed.data, c.req.raw);
  const duplicateFilters = [
    email ? eq(leads.email, email) : null,
    phone ? eq(leads.phone, phone) : null,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));

  const duplicate = duplicateFilters.length
    ? await db.query.leads.findFirst({
        where: and(
          eq(leads.orgId, org.id),
          or(...duplicateFilters)!,
        ),
      })
    : null;

  if (duplicate) {
    await db.insert(auditLogs).values({
      orgId: org.id,
      action: 'lead.capture.duplicate',
      entityType: 'lead',
      entityId: duplicate.id,
      metadata: { source, ...metadata },
      ipAddress: clientIp(c.req.raw),
      userAgent: c.req.header('user-agent'),
    });
    const payload = { data: { id: duplicate.id, duplicate: true } };
    if (idempotencyKey) {
      await c.env.KV.put(idempotencyKey, JSON.stringify({ status: 202, payload }), { expirationTtl: 86400 });
    }
    return c.json(payload, 202);
  }

  const existingSource = await db.query.leadSources.findFirst({
    where: and(eq(leadSources.orgId, org.id), eq(leadSources.name, source)),
  });
  if (!existingSource) {
    await db.insert(leadSources).values({
      orgId: org.id,
      name: source,
      type: sourceType(parsed.data),
      cost: '0.00',
      isActive: true,
    });
  }

  const [lead] = await db.insert(leads).values({
    orgId: org.id,
    name: parsed.data.name,
    phone,
    email,
    streetAddress: parsed.data.streetAddress,
    city: parsed.data.city,
    state: parsed.data.state,
    postalCode: parsed.data.postalCode,
    source,
    status: 'new',
  }).returning();

  await Promise.all([
    db.insert(auditLogs).values({
      orgId: org.id,
      action: 'lead.capture.created',
      entityType: 'lead',
      entityId: lead.id,
      metadata: { source, ...metadata },
      ipAddress: clientIp(c.req.raw),
      userAgent: c.req.header('user-agent'),
    }),
    db.insert(activities).values({
      orgId: org.id,
      leadId: lead.id,
      type: 'lead_capture',
      title: `New ${source} lead`,
      notes: parsed.data.message || null,
      metadata,
    }),
    db.insert(notificationEvents).values({
      orgId: org.id,
      type: 'lead.created',
      title: `New lead from ${source}`,
      body: `${lead.name} submitted a website inquiry.`,
      href: `/leads/${lead.id}`,
      priority: 'normal',
      sourceType: 'lead',
      sourceId: lead.id,
      leadId: lead.id,
      metadata,
    }),
  ]);

  const payload = { data: { id: lead.id, duplicate: false } };
  if (idempotencyKey) {
    await c.env.KV.put(idempotencyKey, JSON.stringify({ status: 201, payload }), { expirationTtl: 86400 });
  }
  return c.json(payload, 201);
});

export default leadCaptureRoute;
