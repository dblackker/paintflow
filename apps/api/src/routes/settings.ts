import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { orgSettings, serviceAreas, teamMembers, orgBranding, stripeConnections } from '@paintflow/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { legalSettingsFromPreferences, readPreferenceObject } from '../lib/legal-settings';

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

settings.use('*', authMiddleware);

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(max).optional()
);
const optionalEmail = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().email().max(255).optional()
);

const teamMemberSchema = z.object({
  name: z.string().trim().min(1),
  email: optionalEmail,
  role: z.string().trim().min(1),
  hourlyRate: z.coerce.number().min(0).default(0),
  burdenRate: z.coerce.number().min(0).max(100).default(30),
  isActive: z.boolean().optional(),
});

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
  paymentTerms: z.string().trim().max(255).optional(),
  acceptChecks: z.boolean().optional(),
  acceptCash: z.boolean().optional(),
  onboardingCompletedAt: z.string().datetime().optional(),
}).strict();

const dashboardActionsSchema = z.object({
  actions: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    visible: z.boolean(),
  })).max(20),
}).strict();

const timeClockSettingsSchema = z.object({
  roundingIncrementMinutes: z.coerce.number().int().refine((value) => [1, 5, 6, 15].includes(value), {
    message: 'Rounding must be exact, 5, 6, or 15 minutes',
  }).optional(),
  maxShiftHours: z.coerce.number().min(4).max(24).optional(),
  reminderWindowStartHour: z.coerce.number().int().min(0).max(23).optional(),
  reminderWindowEndHour: z.coerce.number().int().min(1).max(24).optional(),
}).strict();

const legalSettingsSchema = z.object({
  jurisdiction: z.string().trim().max(80).optional(),
  contractorRegistrationNumber: z.string().trim().max(120).optional(),
  bondAmount: z.string().trim().max(120).optional(),
  contractTerms: z.string().trim().max(12000).optional(),
  disclosureEnabled: z.boolean().optional(),
  disclosureRequired: z.boolean().optional(),
  disclosureTitle: z.string().trim().max(255).optional(),
  disclosureText: z.string().trim().max(12000).optional(),
  legalReviewNote: z.string().trim().max(1000).optional(),
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

function readBusinessHours(value: unknown): Record<string, unknown> {
  return readPreferenceObject(value);
}

function timeClockSettingsFromPreferences(preferences: Record<string, unknown>) {
  const raw = preferences.timeClock && typeof preferences.timeClock === 'object' && !Array.isArray(preferences.timeClock)
    ? preferences.timeClock as Record<string, unknown>
    : {};
  const rounding = Number(raw.roundingIncrementMinutes);
  const maxShift = Number(raw.maxShiftHours);
  const start = Number(raw.reminderWindowStartHour);
  const end = Number(raw.reminderWindowEndHour);
  return {
    roundingIncrementMinutes: [1, 5, 6, 15].includes(rounding) ? rounding : 15,
    maxShiftHours: maxShift >= 4 && maxShift <= 24 ? maxShift : 12,
    reminderWindowStartHour: start >= 0 && start <= 23 ? start : 18,
    reminderWindowEndHour: end >= 1 && end <= 24 ? end : 22,
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

settings.get('/dashboard-actions', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });

  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }

  const preferences = readBusinessHours(settings.businessHours);
  const actions = Array.isArray(preferences.dashboardQuickActions)
    ? preferences.dashboardQuickActions
    : [];

  return c.json({ data: { actions } });
});

settings.put('/dashboard-actions', async (c) => {
  const orgId = c.get('orgId');
  const parsed = dashboardActionsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const currentPreferences = readBusinessHours(existing?.businessHours);
  const businessHours = {
    ...currentPreferences,
    dashboardQuickActions: parsed.data.actions,
  };

  const [settings] = await db
    .insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    })
    .returning();

  return c.json({ data: { actions: readBusinessHours(settings.businessHours).dashboardQuickActions ?? [] } });
});

settings.get('/time-clock', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }

  return c.json({ data: timeClockSettingsFromPreferences(readBusinessHours(settings.businessHours)) });
});

settings.put('/time-clock', async (c) => {
  const orgId = c.get('orgId');
  const parsed = timeClockSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const preferences = readBusinessHours(existing?.businessHours);
  const current = timeClockSettingsFromPreferences(preferences);
  const timeClock = {
    ...current,
    ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
  };
  const businessHours = { ...preferences, timeClock };

  const [settings] = await db.insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    })
    .returning();

  return c.json({ data: timeClockSettingsFromPreferences(readBusinessHours(settings.businessHours)) });
});

settings.get('/legal', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });

  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }

  return c.json({ data: legalSettingsFromPreferences(readBusinessHours(settings.businessHours)) });
});

settings.put('/legal', async (c) => {
  const orgId = c.get('orgId');
  const parsed = legalSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const preferences = readBusinessHours(existing?.businessHours);
  const currentLegal = legalSettingsFromPreferences(preferences);
  const legal = {
    ...currentLegal,
    ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
  };
  const businessHours = { ...preferences, legal };

  const [settings] = await db.insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    })
    .returning();

  return c.json({ data: legalSettingsFromPreferences(readBusinessHours(settings.businessHours)) });
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
  
  const members = await db.select().from(teamMembers).where(eq(teamMembers.orgId, orgId));
  members.sort((a, b) => {
    const activeDelta = Number(b.isActive !== false) - Number(a.isActive !== false);
    if (activeDelta !== 0) return activeDelta;
    return (a.name || '').localeCompare(b.name || '');
  });
  
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
    isActive: parsed.data.isActive ?? true,
  }).returning();
  
  return c.json({ data: member }, 201);
});

// PATCH /v1/settings/team/:id
settings.patch('/team/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = teamMemberSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    updates[key] = key === 'hourlyRate' || key === 'burdenRate' ? Number(value).toFixed(2) : value;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No supported team member fields provided' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [member] = await db.update(teamMembers)
    .set(updates)
    .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)))
    .returning();

  if (!member) {
    return c.json({ error: 'Team member not found' }, 404);
  }

  return c.json({ data: member });
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
