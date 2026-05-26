import { Hono } from 'hono';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { createDb } from '@paintflow/db';
import { supplierCatalogColors, supplierCatalogProductColors, supplierCatalogProducts, supplierCatalogSyncRuns } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const catalogApp = new Hono<{ Bindings: Env; Variables: Variables }>();
catalogApp.use('*', authMiddleware);

function intParam(value: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

catalogApp.get('/products', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const q = c.req.query('q')?.trim();
  const type = c.req.query('type')?.trim();
  const supplierId = c.req.query('supplierId')?.trim();
  const limit = intParam(c.req.query('limit'), 50, 100);

  const conditions = [eq(supplierCatalogProducts.isActive, true)];
  if (q) {
    conditions.push(or(
      ilike(supplierCatalogProducts.name, `%${q}%`),
      ilike(supplierCatalogProducts.productLine, `%${q}%`),
      ilike(supplierCatalogProducts.sku, `%${q}%`)
    )!);
  }
  if (type) conditions.push(eq(supplierCatalogProducts.type, type));
  if (supplierId) conditions.push(eq(supplierCatalogProducts.supplierId, supplierId));

  const data = await db.query.supplierCatalogProducts.findMany({
    where: and(...conditions),
    orderBy: [supplierCatalogProducts.supplierName, supplierCatalogProducts.productLine, supplierCatalogProducts.name],
    limit,
  });

  return c.json({ data });
});

catalogApp.get('/colors', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const q = c.req.query('q')?.trim();
  const supplierId = c.req.query('supplierId')?.trim();
  const family = c.req.query('family')?.trim();
  const popularOnly = c.req.query('popular') === '1' || c.req.query('popular') === 'true';
  const limit = intParam(c.req.query('limit'), 80, 160);

  const conditions = [eq(supplierCatalogColors.isActive, true)];
  if (q) {
    conditions.push(or(
      ilike(supplierCatalogColors.name, `%${q}%`),
      ilike(supplierCatalogColors.colorCode, `%${q}%`),
      ilike(supplierCatalogColors.collection, `%${q}%`)
    )!);
  }
  if (supplierId) conditions.push(eq(supplierCatalogColors.supplierId, supplierId));
  if (family) conditions.push(eq(supplierCatalogColors.family, family));
  if (popularOnly) conditions.push(eq(supplierCatalogColors.isPopular, true));

  const data = await db.query.supplierCatalogColors.findMany({
    where: and(...conditions),
    orderBy: [desc(supplierCatalogColors.isPopular), supplierCatalogColors.supplierName, supplierCatalogColors.family, supplierCatalogColors.name],
    limit,
  });

  return c.json({ data });
});

catalogApp.get('/products/:id/colors', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const id = c.req.param('id');
  const data = await db
    .select({
      mappingId: supplierCatalogProductColors.id,
      baseRequired: supplierCatalogProductColors.baseRequired,
      recommendedUse: supplierCatalogProductColors.recommendedUse,
      color: supplierCatalogColors,
    })
    .from(supplierCatalogProductColors)
    .innerJoin(supplierCatalogColors, eq(supplierCatalogProductColors.colorId, supplierCatalogColors.id))
    .where(and(
      eq(supplierCatalogProductColors.productId, id),
      eq(supplierCatalogProductColors.isAvailable, true),
      eq(supplierCatalogColors.isActive, true)
    ))
    .orderBy(desc(supplierCatalogColors.isPopular), supplierCatalogColors.family, supplierCatalogColors.name)
    .limit(160);

  return c.json({ data });
});

catalogApp.get('/colors/:id/products', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const id = c.req.param('id');
  const data = await db
    .select({
      mappingId: supplierCatalogProductColors.id,
      baseRequired: supplierCatalogProductColors.baseRequired,
      recommendedUse: supplierCatalogProductColors.recommendedUse,
      product: supplierCatalogProducts,
    })
    .from(supplierCatalogProductColors)
    .innerJoin(supplierCatalogProducts, eq(supplierCatalogProductColors.productId, supplierCatalogProducts.id))
    .where(and(
      eq(supplierCatalogProductColors.colorId, id),
      eq(supplierCatalogProductColors.isAvailable, true),
      eq(supplierCatalogProducts.isActive, true)
    ))
    .orderBy(supplierCatalogProducts.supplierName, supplierCatalogProducts.productLine, supplierCatalogProducts.name)
    .limit(100);

  return c.json({ data });
});

catalogApp.get('/status', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const [latestRun] = await db.query.supplierCatalogSyncRuns.findMany({
    orderBy: [desc(supplierCatalogSyncRuns.startedAt)],
    limit: 1,
  });

  const [counts] = await db
    .select({
      productCount: sql<number>`count(distinct ${supplierCatalogProducts.id})`,
      colorCount: sql<number>`count(distinct ${supplierCatalogColors.id})`,
    })
    .from(supplierCatalogProducts)
    .leftJoin(supplierCatalogColors, eq(supplierCatalogProducts.supplierId, supplierCatalogColors.supplierId));

  return c.json({ data: { latestRun: latestRun || null, counts } });
});

export default catalogApp;
