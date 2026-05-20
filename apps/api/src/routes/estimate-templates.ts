import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimateTemplates } from '@paintflow/db/schema';
import { eq, and, desc, or } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const templatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
templatesApp.use('*', authMiddleware);

const templateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.enum(['room', 'full_estimate', 'package']).default('room'),
  isShared: z.boolean().default(false),
  isSmart: z.boolean().default(false),
  rooms: z.array(z.object({
    name: z.string(),
    roomType: z.string().optional(),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    items: z.array(z.object({
      category: z.string(),
      productionRateId: z.string().optional(),
      quantity: z.number().positive(),
      prepLevel: z.string().optional(),
      notes: z.string().optional(),
    })),
  })),
  packages: z.array(z.any()).optional(),
});

const BUILTIN_TEMPLATES = [
  {
    name: 'Master Bedroom',
    description: '4 walls, ceiling, trim',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Master Bedroom',
      roomType: 'bedroom',
      length: 15,
      width: 12,
      items: [
        { category: 'walls', quantity: 480, prepLevel: 'standard' },
        { category: 'ceiling', quantity: 180, prepLevel: 'standard' },
        { category: 'trim', quantity: 60, prepLevel: 'standard' },
      ]
    }]
  },
  {
    name: 'Kitchen',
    description: 'Walls, ceiling, cabinets',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Kitchen',
      roomType: 'kitchen',
      length: 15,
      width: 10,
      items: [
        { category: 'walls', quantity: 400, prepLevel: 'standard' },
        { category: 'ceiling', quantity: 150, prepLevel: 'standard' },
        { category: 'cabinets', quantity: 20, prepLevel: 'heavy' },
      ]
    }]
  },
  {
    name: 'Living Room',
    description: '4 walls, ceiling, trim',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Living Room',
      roomType: 'living_room',
      length: 20,
      width: 12,
      items: [
        { category: 'walls', quantity: 560, prepLevel: 'standard' },
        { category: 'ceiling', quantity: 240, prepLevel: 'standard' },
        { category: 'trim', quantity: 72, prepLevel: 'standard' },
      ]
    }]
  },
  {
    name: 'Bathroom',
    description: 'Small room with moisture resistance',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Bathroom',
      roomType: 'bathroom',
      length: 10,
      width: 6,
      items: [
        { category: 'walls', quantity: 280, prepLevel: 'heavy' },
        { category: 'ceiling', quantity: 60, prepLevel: 'standard' },
        { category: 'trim', quantity: 40, prepLevel: 'standard' },
      ]
    }]
  },
];

templatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const db = createDb(c.env.DATABASE_URL);
  
  let templates = await db.query.estimateTemplates.findMany({
    where: and(
      eq(estimateTemplates.orgId, orgId),
      or(
        eq(estimateTemplates.isShared, true),
        eq(estimateTemplates.createdBy, userId)
      )
    ),
    orderBy: [desc(estimateTemplates.usageCount)],
  });
  
  // Seed built-ins if empty
  if (templates.length === 0) {
    const seeded = await db.insert(estimateTemplates).values(
      BUILTIN_TEMPLATES.map(t => ({ orgId, createdBy: userId, ...t }))
    ).returning();
    templates = seeded;
  }
  
  return c.json({ data: templates });
});

templatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = templateSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [template] = await db.insert(estimateTemplates).values({
    orgId,
    createdBy: userId,
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    isShared: parsed.isShared,
    isSmart: parsed.isSmart,
    rooms: parsed.rooms,
    packages: parsed.packages,
  }).returning();
  
  return c.json({ data: template }, 201);
});

templatesApp.post('/:id/use', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const template = await db.query.estimateTemplates.findFirst({
    where: and(
      eq(estimateTemplates.id, id),
      eq(estimateTemplates.orgId, orgId)
    ),
  });
  
  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }
  
  // Increment usage count
  await db.update(estimateTemplates)
    .set({ usageCount: template.usageCount + 1 })
    .where(eq(estimateTemplates.id, id));
  
  return c.json({ data: template });
});

templatesApp.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = templateSchema.partial().parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [template] = await db.update(estimateTemplates)
    .set({ ...parsed, updatedAt: new Date() })
    .where(and(eq(estimateTemplates.id, id), eq(estimateTemplates.orgId, orgId)))
    .returning();
  
  return c.json({ data: template });
});

templatesApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  await db.delete(estimateTemplates)
    .where(and(eq(estimateTemplates.id, id), eq(estimateTemplates.orgId, orgId)));
  
  return c.json({ success: true });
});

export default templatesApp;
