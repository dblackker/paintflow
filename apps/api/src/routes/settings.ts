import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { orgSettings, organizations, serviceAreas, teamMembers, orgBranding, stripeConnections } from '@crewmodo/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { legalSettingsFromPreferences, readPreferenceObject } from '../lib/legal-settings';
import { paymentScheduleSettingsFromPreferences } from '../lib/payment-schedule';

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
  clockOutWarningHours: z.coerce.number().min(1).max(24).optional(),
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

const paymentScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  milestones: z.array(z.object({
    key: z.string().trim().max(80).optional(),
    label: z.string().trim().min(1).max(80),
    due: z.string().trim().min(1).max(160),
    percent: z.coerce.number().positive().max(100),
    payable: z.boolean().optional(),
  })).min(1).max(6),
}).strict().superRefine((data, ctx) => {
  const total = data.milestones.reduce((sum, item) => sum + Number(item.percent || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Payment milestone percentages must total 100%',
      path: ['milestones'],
    });
  }
});

const brandingPatchSchema = z.object({
  companyName: optionalText(255),
  logoUrl: optionalText(2000),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

const leadIntakeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultSource: optionalText(100),
  allowedDomains: z.array(z.string().trim().toLowerCase().max(120)).max(20).optional(),
  requireSecret: z.boolean().optional(),
  notifyOwners: z.boolean().optional(),
}).strict();

const logoUploadLimits = {
  maxBytes: 512 * 1024,
  minWidth: 64,
  minHeight: 32,
  maxWidth: 1600,
  maxHeight: 800,
  minRatio: 0.5,
  maxRatio: 8,
};

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const dataOffset = offset + 8;
    if (dataOffset + size > bytes.length) return null;

    if (type === 'VP8X' && size >= 10) {
      return {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1,
      };
    }

    if (type === 'VP8L' && size >= 5 && bytes[dataOffset] === 0x2f) {
      const b1 = bytes[dataOffset + 1];
      const b2 = bytes[dataOffset + 2];
      const b3 = bytes[dataOffset + 3];
      const b4 = bytes[dataOffset + 4];
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
    }

    if (type === 'VP8 ' && size >= 10 && bytes[dataOffset + 3] === 0x9d && bytes[dataOffset + 4] === 0x01 && bytes[dataOffset + 5] === 0x2a) {
      const width = new DataView(bytes.buffer, bytes.byteOffset + dataOffset + 6, 2).getUint16(0, true) & 0x3fff;
      const height = new DataView(bytes.buffer, bytes.byteOffset + dataOffset + 8, 2).getUint16(0, true) & 0x3fff;
      return { width, height };
    }

    offset = dataOffset + size + (size % 2);
  }

  return null;
}

function validateLogoDimensions(dimensions: { width: number; height: number } | null) {
  if (!dimensions) return 'Logo file is not a valid WebP image.';
  const ratio = dimensions.width / dimensions.height;
  if (
    dimensions.width < logoUploadLimits.minWidth
    || dimensions.height < logoUploadLimits.minHeight
    || dimensions.width > logoUploadLimits.maxWidth
    || dimensions.height > logoUploadLimits.maxHeight
    || ratio < logoUploadLimits.minRatio
    || ratio > logoUploadLimits.maxRatio
  ) {
    return `Logo must be ${logoUploadLimits.minWidth}-${logoUploadLimits.maxWidth}px wide, ${logoUploadLimits.minHeight}-${logoUploadLimits.maxHeight}px tall, and not extremely wide or tall.`;
  }
  return '';
}

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
  const warning = Number(raw.clockOutWarningHours);
  const maxShift = Number(raw.maxShiftHours);
  const start = Number(raw.reminderWindowStartHour);
  const end = Number(raw.reminderWindowEndHour);
  return {
    roundingIncrementMinutes: [1, 5, 6, 15].includes(rounding) ? rounding : 5,
    clockOutWarningHours: warning >= 1 && warning <= 24 ? warning : 8,
    maxShiftHours: maxShift >= 4 && maxShift <= 24 ? maxShift : 12,
    reminderWindowStartHour: start >= 0 && start <= 23 ? start : 18,
    reminderWindowEndHour: end >= 1 && end <= 24 ? end : 22,
  };
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
  }
}

function generateLeadIntakeSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function leadIntakeSettingsFromPreferences(preferences: Record<string, unknown>) {
  const raw = preferences.leadIntake && typeof preferences.leadIntake === 'object' && !Array.isArray(preferences.leadIntake)
    ? preferences.leadIntake as Record<string, unknown>
    : {};
  const allowedDomains = Array.isArray(raw.allowedDomains)
    ? raw.allowedDomains.map((domain) => normalizeDomain(String(domain))).filter(Boolean)
    : [];
  return {
    enabled: raw.enabled !== false,
    defaultSource: typeof raw.defaultSource === 'string' && raw.defaultSource.trim() ? raw.defaultSource.trim() : 'Website form',
    allowedDomains: Array.from(new Set(allowedDomains)),
    requireSecret: Boolean(raw.requireSecret),
    notifyOwners: raw.notifyOwners !== false,
    secret: typeof raw.secret === 'string' && raw.secret.trim() ? raw.secret.trim() : '',
  };
}

function publicLeadCaptureUrl(requestUrl: string, orgSlug: string) {
  return `${new URL(requestUrl).origin}/v1/lead-capture/${orgSlug}`;
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

settings.get('/lead-intake', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [org, settings] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  if (!org) return c.json({ error: 'Organization not found' }, 404);

  const preferences = readBusinessHours(settings?.businessHours);
  const leadIntake = leadIntakeSettingsFromPreferences(preferences);
  return c.json({
    data: {
      ...leadIntake,
      orgSlug: org.slug,
      endpointUrl: publicLeadCaptureUrl(c.req.url, org.slug),
    },
  });
});

settings.put('/lead-intake', async (c) => {
  const orgId = c.get('orgId');
  const parsed = leadIntakeSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [org, existing] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  if (!org) return c.json({ error: 'Organization not found' }, 404);

  const preferences = readBusinessHours(existing?.businessHours);
  const current = leadIntakeSettingsFromPreferences(preferences);
  const leadIntake = {
    ...current,
    enabled: parsed.data.enabled ?? current.enabled,
    defaultSource: parsed.data.defaultSource || current.defaultSource,
    allowedDomains: Array.from(new Set((parsed.data.allowedDomains || current.allowedDomains).map(normalizeDomain).filter(Boolean))),
    requireSecret: parsed.data.requireSecret ?? current.requireSecret,
    notifyOwners: parsed.data.notifyOwners ?? current.notifyOwners,
    secret: current.secret || generateLeadIntakeSecret(),
  };
  const businessHours = { ...preferences, leadIntake };

  const [settings] = await db.insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    })
    .returning();

  return c.json({
    data: {
      ...leadIntakeSettingsFromPreferences(readBusinessHours(settings.businessHours)),
      orgSlug: org.slug,
      endpointUrl: publicLeadCaptureUrl(c.req.url, org.slug),
    },
  });
});

settings.post('/lead-intake/rotate-secret', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [org, existing] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) }),
  ]);
  if (!org) return c.json({ error: 'Organization not found' }, 404);

  const preferences = readBusinessHours(existing?.businessHours);
  const leadIntake = {
    ...leadIntakeSettingsFromPreferences(preferences),
    secret: generateLeadIntakeSecret(),
  };
  const businessHours = { ...preferences, leadIntake };
  const [settings] = await db.insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    })
    .returning();

  return c.json({
    data: {
      ...leadIntakeSettingsFromPreferences(readBusinessHours(settings.businessHours)),
      orgSlug: org.slug,
      endpointUrl: publicLeadCaptureUrl(c.req.url, org.slug),
    },
  });
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

settings.get('/payment-schedule', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });

  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }

  return c.json({ data: paymentScheduleSettingsFromPreferences(settings) });
});

settings.put('/payment-schedule', async (c) => {
  const orgId = c.get('orgId');
  const parsed = paymentScheduleSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const preferences = readBusinessHours(existing?.businessHours);
  const paymentSchedule = {
    enabled: parsed.data.enabled !== false,
    milestones: parsed.data.milestones.map((milestone, index) => ({
      key: (milestone.key || milestone.label)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || `milestone_${index + 1}`,
      label: milestone.label,
      due: milestone.due,
      percent: Number(milestone.percent),
      payable: Boolean(milestone.payable),
    })),
  };
  const businessHours = { ...preferences, paymentSchedule };
  const firstPayable = paymentSchedule.milestones.find((milestone) => milestone.payable);
  const depositPercent = (firstPayable?.percent ?? paymentSchedule.milestones[0]?.percent ?? 0).toFixed(2);
  const paymentTerms = paymentSchedule.milestones
    .map((milestone) => `${milestone.percent}% ${milestone.label.toLowerCase()} (${milestone.due.toLowerCase()})`)
    .join(', ')
    .slice(0, 255);

  const [settings] = await db.insert(orgSettings)
    .values({ orgId, businessHours, depositPercent, paymentTerms })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, depositPercent, paymentTerms, updatedAt: new Date() },
    })
    .returning();

  return c.json({ data: paymentScheduleSettingsFromPreferences(settings) });
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

settings.put('/branding/logo', async (c) => {
  const orgId = c.get('orgId');
  if (!c.env.R2) {
    return c.json({ error: 'Logo storage is not configured for this environment.' }, 503);
  }

  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Upload a logo file.' }, 400);
  }

  if (file.type !== 'image/webp') {
    return c.json({ error: 'Logo must be uploaded as WebP.' }, 400);
  }

  if (file.size <= 0 || file.size > logoUploadLimits.maxBytes) {
    return c.json({ error: 'Logo must be smaller than 512 KB after optimization.' }, 400);
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const dimensionError = validateLogoDimensions(webpDimensions(bytes));
  if (dimensionError) {
    return c.json({ error: dimensionError }, 400);
  }

  const key = `branding/${orgId}/logo.webp`;
  await c.env.R2.put(key, buffer, {
    httpMetadata: { contentType: 'image/webp' },
    customMetadata: {
      orgId,
      uploadedAt: new Date().toISOString(),
      originalName: file.name.slice(0, 120),
    },
  });

  const logoUrl = `${new URL(c.req.url).origin}/v1/uploads/branding/${orgId}/logo?v=${Date.now()}`;
  const db = createDb(c.env.DATABASE_URL);
  const [branding] = await db
    .insert(orgBranding)
    .values({ orgId, logoUrl })
    .onConflictDoUpdate({
      target: orgBranding.orgId,
      set: { logoUrl, updatedAt: new Date() },
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
