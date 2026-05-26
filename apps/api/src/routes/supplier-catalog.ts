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

function supplierLabel(supplierId: string) {
  const labels: Record<string, string> = {
    'benjamin-moore': 'Benjamin Moore',
    ppg: 'PPG Paints',
    'sherwin-williams': 'Sherwin-Williams',
  };
  return labels[supplierId] || supplierId;
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

  const [[productCounts], [colorCounts], productSuppliers, colorSuppliers, recentRuns] = await Promise.all([
    db
      .select({ productCount: sql<number>`count(*)` })
      .from(supplierCatalogProducts)
      .where(eq(supplierCatalogProducts.isActive, true)),
    db
      .select({ colorCount: sql<number>`count(*)` })
      .from(supplierCatalogColors)
      .where(eq(supplierCatalogColors.isActive, true)),
    db
      .select({
        supplierId: supplierCatalogProducts.supplierId,
        supplierName: supplierCatalogProducts.supplierName,
        productCount: sql<number>`count(*)`,
        lastProductSeenAt: sql<Date | null>`max(${supplierCatalogProducts.lastSeenAt})`,
      })
      .from(supplierCatalogProducts)
      .where(eq(supplierCatalogProducts.isActive, true))
      .groupBy(supplierCatalogProducts.supplierId, supplierCatalogProducts.supplierName),
    db
      .select({
        supplierId: supplierCatalogColors.supplierId,
        supplierName: supplierCatalogColors.supplierName,
        colorCount: sql<number>`count(*)`,
        lastColorSeenAt: sql<Date | null>`max(${supplierCatalogColors.lastSeenAt})`,
      })
      .from(supplierCatalogColors)
      .where(eq(supplierCatalogColors.isActive, true))
      .groupBy(supplierCatalogColors.supplierId, supplierCatalogColors.supplierName),
    db.query.supplierCatalogSyncRuns.findMany({
      orderBy: [desc(supplierCatalogSyncRuns.startedAt)],
      limit: 25,
    }),
  ]);

  const suppliers = new Map<string, {
    supplierId: string;
    supplierName: string;
    productCount: number;
    colorCount: number;
    lastProductSeenAt: Date | null;
    lastColorSeenAt: Date | null;
  }>();

  function ensureSupplier(supplierId: string, supplierName?: string | null) {
    if (!suppliers.has(supplierId)) {
      suppliers.set(supplierId, {
        supplierId,
        supplierName: supplierName || supplierLabel(supplierId),
        productCount: 0,
        colorCount: 0,
        lastProductSeenAt: null,
        lastColorSeenAt: null,
      });
    }
    return suppliers.get(supplierId)!;
  }

  for (const row of productSuppliers) {
    const supplier = ensureSupplier(row.supplierId, row.supplierName);
    supplier.productCount = Number(row.productCount || 0);
    supplier.lastProductSeenAt = row.lastProductSeenAt;
  }

  for (const row of colorSuppliers) {
    const supplier = ensureSupplier(row.supplierId, row.supplierName);
    supplier.colorCount = Number(row.colorCount || 0);
    supplier.lastColorSeenAt = row.lastColorSeenAt;
  }

  for (const run of recentRuns) {
    const runSuppliers = Array.isArray(run.suppliers) ? run.suppliers.map(String) : [];
    for (const supplierId of runSuppliers) ensureSupplier(supplierId);
  }

  const supplierStatuses = Array.from(suppliers.values())
    .map((supplier) => {
      const latestSupplierRun = recentRuns.find((run) => Array.isArray(run.suppliers) && run.suppliers.map(String).includes(supplier.supplierId));
      const seenTimes = [supplier.lastProductSeenAt, supplier.lastColorSeenAt]
        .filter(Boolean)
        .map((value) => new Date(value as Date).getTime())
        .filter((value) => Number.isFinite(value));
      const lastCatalogSeenAt = seenTimes.length ? new Date(Math.max(...seenTimes)) : null;
      return {
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        productCount: supplier.productCount,
        colorCount: supplier.colorCount,
        lastCatalogSeenAt,
        lastSyncStatus: latestSupplierRun?.status || null,
        lastSyncAt: latestSupplierRun?.finishedAt || latestSupplierRun?.startedAt || null,
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

  return c.json({
    data: {
      latestRun: latestRun || null,
      suppliers: supplierStatuses,
      counts: {
        productCount: productCounts?.productCount || 0,
        colorCount: colorCounts?.colorCount || 0,
      },
    },
  });
});

export default catalogApp;
