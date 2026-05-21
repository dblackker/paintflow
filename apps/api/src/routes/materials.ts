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

import { flattenCatalog } from '../lib/materials-catalog';

const DEFAULT_MATERIALS = flattenCatalog().slice(0, 20);

materialsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  let allMaterials = await db.query.materials.findMany({
    where: eq(materials.orgId, orgId),
    orderBy: [desc(materials.createdAt)],
  });
  let data = allMaterials.filter((material) => material.isActive !== false);
  
  if (allMaterials.length === 0) {
    const seeded = await db.insert(materials).values(
      DEFAULT_MATERIALS.map((m: any) => ({
        orgId,
        name: m.name,
        category: m.category,
        brand: m.brand,
        unit: m.unit,
        costPerUnit: String(m.costPerUnit),
        markupPercent: String(m.markupPercent ?? 30),
        coverageSqFt: m.coverageSqFt == null ? undefined : String(m.coverageSqFt),
        supplier: m.supplier,
        sku: m.sku,
      }))
    ).returning();
    data = seeded;
    allMaterials = seeded;
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
    name: parsed.name,
    category: parsed.category,
    brand: parsed.brand,
    unit: parsed.unit,
    supplier: parsed.supplier,
    sku: parsed.sku,
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
  
  await db.update(materials)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(materials.id, id), eq(materials.orgId, orgId)));
  
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
