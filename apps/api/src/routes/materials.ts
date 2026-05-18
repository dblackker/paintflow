import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { materials } from '@paintflow/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const materialsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
materialsApp.use('*', authMiddleware);

const materialSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().min(1),
  brand: z.string().optional(),
  unit: z.string().min(1),
  costPerUnit: z.number().positive(),
  markupPercent: z.number().min(0).max(200).default(30),
  coverageSqFt: z.number().positive().optional(),
  supplier: z.string().optional(),
  sku: z.string().optional(),
});

const DEFAULT_MATERIALS = [
  { name: 'Sherwin Williams SuperPaint', category: 'paint', brand: 'Sherwin Williams', unit: 'gallon', costPerUnit: 65, markupPercent: 30, coverageSqFt: 350 },
  { name: 'Benjamin Moore Regal Select', category: 'paint', brand: 'Benjamin Moore', unit: 'gallon', costPerUnit: 70, markupPercent: 30, coverageSqFt: 400 },
  { name: 'Kilz 2 Primer', category: 'primer', brand: 'Kilz', unit: 'gallon', costPerUnit: 25, markupPercent: 30, coverageSqFt: 300 },
  { name: 'Painter\'s Tape', category: 'supplies', brand: '3M', unit: 'roll', costPerUnit: 8, markupPercent: 50 },
  { name: 'Drop Cloths', category: 'supplies', unit: 'each', costPerUnit: 15, markupPercent: 50 },
  { name: 'Roller Covers', category: 'supplies', unit: 'each', costPerUnit: 5, markupPercent: 50 },
];

materialsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  let data = await db.query.materials.findMany({
    where: eq(materials.orgId, orgId),
    orderBy: [desc(materials.createdAt)],
  });
  
  if (data.length === 0) {
    const seeded = await db.insert(materials).values(
      DEFAULT_MATERIALS.map(m => ({ orgId, ...m }))
    ).returning();
    data = seeded;
  }
  
  return c.json({ data });
});

materialsApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = materialSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [material] = await db.insert(materials).values({
    orgId,
    ...parsed,
    costPerUnit: parsed.costPerUnit.toString(),
    markupPercent: parsed.markupPercent.toString(),
    coverageSqFt: parsed.coverageSqFt?.toString(),
  }).returning();
  
  return c.json({ data: material }, 201);
});

materialsApp.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = materialSchema.partial().parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [material] = await db.update(materials)
    .set({
      ...parsed,
      costPerUnit: parsed.costPerUnit?.toString(),
      markupPercent: parsed.markupPercent?.toString(),
      coverageSqFt: parsed.coverageSqFt?.toString(),
      updatedAt: new Date(),
    })
    .where(and(eq(materials.id, id), eq(materials.orgId, orgId)))
    .returning();
  
  return c.json({ data: material });
});

materialsApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  await db.delete(materials).where(and(eq(materials.id, id), eq(materials.orgId, orgId)));
  
  return c.json({ success: true });
});

materialsApp.post('/calculate', async (c) => {
  const { sqFt, materialId } = await c.req.json();
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const material = await db.query.materials.findFirst({
    where: and(eq(materials.id, materialId), eq(materials.orgId, orgId)),
  });
  
  if (!material || !material.coverageSqFt) {
    return c.json({ error: 'Material not found or no coverage data' }, 404);
  }
  
  const gallons = Math.ceil(sqFt / parseFloat(material.coverageSqFt));
  const cost = gallons * parseFloat(material.costPerUnit);
  const price = cost * (1 + parseFloat(material.markupPercent) / 100);
  
  return c.json({ data: { gallons, cost: cost.toFixed(2), price: price.toFixed(2) } });
});

export default materialsApp;
