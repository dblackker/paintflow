import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { orgSettings, serviceAreas, teamMembers, orgBranding, stripeConnections } from '@paintflow/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

settings.use('*', authMiddleware);

const teamMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  role: z.string().min(1),
  hourlyRate: z.coerce.number().min(0).default(0),
  burdenRate: z.coerce.number().min(0).max(100).default(30),
});

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(max).optional()
);
const optionalEmail = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().email().max(255).optional()
);

const orgSettingsPatchSchema = z.object({
  companyName: z.string().trim().min(1).max(255).optional(),
  phone: optionalText(50),
  email: optionalEmail,
  address: optionalText(2000),
  website: optionalText(255),
  defaultLaborRate: z.coerce.number().min(0).max(1000).optional(),
  materialMarkupPercent: z.coerce.number().min(0).max(500).optional(),
  salesTaxRate: z.coerce.number().min(0).max(100).optional(),
  depositPercent: z.coerce.number().min(0).max(100).optional(),
  googleReviewUrl: optionalText(1000),
  yelpReviewUrl: optionalText(1000),
  reviewRequestDelayHours: z.coerce.number().int().min(0).max(720).optional(),
  estimateValidDays: z.coerce.number().int().min(1).max(365).optional(),
  paymentTerms: z.string().trim().max(50).optional(),
  acceptChecks: z.boolean().optional(),
  acceptCash: z.boolean().optional(),
  onboardingCompletedAt: z.string().datetime().optional(),
}).strict();

const brandingPatchSchema = z.object({
  companyName: optionalText(255),
  logoUrl: optionalText(2000),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

function normalizeOrgSettingsPatch(input: z.infer<typeof orgSettingsPatchSchema>) {
  const patch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (['defaultLaborRate', 'materialMarkupPercent', 'depositPercent'].includes(key)) {
      patch[key] = Number(value).toFixed(2);
    } else if (key === 'salesTaxRate') {
      const numeric = Number(value);
      patch[key] = (numeric > 1 ? numeric / 100 : numeric).toFixed(4);
    } else if (key === 'onboardingCompletedAt') {
      patch[key] = new Date(value as string);
    } else {
      patch[key] = value;
    }
  }

  return patch;
}

function onboardingState(settings: typeof orgSettings.$inferSelect | null, serviceAreaCount: number, hasPayments = false) {
  const hasBusinessBasics = Boolean(settings?.companyName && settings.phone && settings.email && settings.address);
  const hasPricing = Boolean(settings?.defaultLaborRate && settings.materialMarkupPercent && settings.depositPercent);
  const completed = Boolean(settings?.onboardingCompletedAt);
  const steps = [
    { key: 'business', label: 'Business profile', complete: hasBusinessBasics },
    { key: 'pricing', label: 'Pricing defaults', complete: hasPricing },
    { key: 'serviceAreas', label: 'Service areas', complete: serviceAreaCount > 0 },
    { key: 'connectors', label: 'Payment setup', complete: hasPayments },
  ];
  const completedSteps = steps.filter((step) => step.complete).length;

  return {
    completed,
    completedSteps,
    totalSteps: steps.length,
    percent: completed ? 100 : Math.round((completedSteps / steps.length) * 100),
    steps,
    shouldShowUpsell: !completed && hasBusinessBasics,
    upsell: {
      title: 'Keep your trial moving',
      message: 'Contractors who connect payments and accounting before their first estimate can collect deposits and track job costs from day one.',
      cta: 'Compare plans',
      href: '/billing',
    },
  };
}

// GET /v1/settings/org
settings.get('/org', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  
  // Create default if not exists
  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }
  
  return c.json({ data: settings });
});

settings.get('/onboarding', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });

  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }

  const areas = await db.select().from(serviceAreas).where(eq(serviceAreas.orgId, orgId));
  const stripe = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, orgId),
  });

  return c.json({
    data: {
      settings,
      serviceAreas: areas,
      progress: onboardingState(settings, areas.length, Boolean(stripe?.onboardingComplete)),
    },
  });
});

// PATCH /v1/settings/org
settings.patch('/org', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = orgSettingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const patch = normalizeOrgSettingsPatch(parsed.data);
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No supported settings provided' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  
  const [settings] = await db
    .insert(orgSettings)
    .values({ orgId, ...patch })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  
  return c.json({ data: settings });
});

settings.get('/branding', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const [settings, branding] = await Promise.all([
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
    db.query.orgBranding.findFirst({ where: eq(orgBranding.orgId, orgId) }),
  ]);

  return c.json({
    data: {
      companyName: branding?.companyName || settings?.companyName || '',
      logoUrl: branding?.logoUrl || '',
      primaryColor: branding?.primaryColor || '#2563eb',
    },
  });
});

settings.patch('/branding', async (c) => {
  const orgId = c.get('orgId');
  const parsed = brandingPatchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No supported branding fields provided' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [branding] = await db
    .insert(orgBranding)
    .values({ orgId, ...patch })
    .onConflictDoUpdate({
      target: orgBranding.orgId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();

  return c.json({ data: branding });
});

// GET /v1/settings/service-areas
settings.get('/service-areas', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const areas = await db.select().from(serviceAreas).where(eq(serviceAreas.orgId, orgId));
  
  return c.json({ data: areas });
});

// POST /v1/settings/service-areas
settings.post('/service-areas', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = z.object({
    zipCodes: z.array(z.string().trim().regex(/^\d{5}(?:-\d{4})?$/)).max(50),
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  
  // Clear existing
  await db.delete(serviceAreas).where(eq(serviceAreas.orgId, orgId));

  const zipCodes = Array.from(new Set(parsed.data.zipCodes));
  if (zipCodes.length === 0) {
    return c.json({ data: [] });
  }
  
  // Insert new
  const areas = await db.insert(serviceAreas).values(
    zipCodes.map((zip: string) => ({ orgId, zipCode: zip }))
  ).returning();
  
  return c.json({ data: areas });
});

// GET /v1/settings/team
settings.get('/team', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const members = await db.select().from(teamMembers).where(
    and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true))
  );
  
  return c.json({ data: members });
});

// POST /v1/settings/team
settings.post('/team', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = teamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  
  const [member] = await db.insert(teamMembers).values({
    orgId,
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    hourlyRate: parsed.data.hourlyRate.toString(),
    burdenRate: parsed.data.burdenRate.toString(),
  }).returning();
  
  return c.json({ data: member }, 201);
});

// DELETE /v1/settings/team/:id
settings.delete('/team/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  await db.update(teamMembers)
    .set({ isActive: false })
    .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)));

  return c.json({ success: true });
});

export default settings;
