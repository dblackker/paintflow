import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { orgSettings, serviceAreas, teamMembers, orgBranding } from '@paintflow/db/schema';
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

// PATCH /v1/settings/org
settings.patch('/org', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  
  const [settings] = await db
    .insert(orgSettings)
    .values({ orgId, ...body })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { ...body, updatedAt: new Date() },
    })
    .returning();
  
  return c.json({ data: settings });
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
  const { zipCodes } = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  
  // Clear existing
  await db.delete(serviceAreas).where(eq(serviceAreas.orgId, orgId));
  
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
