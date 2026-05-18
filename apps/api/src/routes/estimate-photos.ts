import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimatePhotos } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const photosApp = new Hono<{ Bindings: Env; Variables: Variables }>();
photosApp.use('*', authMiddleware);

const photoSchema = z.object({
  url: z.string().url(),
  roomId: z.string().uuid().optional(),
  annotations: z.array(z.object({
    x: z.number(),
    y: z.number(),
    text: z.string(),
    color: z.string().default('#ff0000'),
  })).optional(),
});

photosApp.get('/:estimateId', async (c) => {
  const orgId = c.get('orgId');
  const estimateId = c.req.param('estimateId');
  const db = createDb(c.env.DATABASE_URL);
  
  // Verify estimate belongs to org
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.orgId, orgId),
  });
  
  const photos = await db.query.estimatePhotos.findMany({
    where: eq(estimatePhotos.estimateId, estimateId),
    orderBy: (photos, { desc }) => [desc(photos.createdAt)],
  });
  
  return c.json({ data: photos });
});

photosApp.post('/:estimateId', async (c) => {
  const orgId = c.get('orgId');
  const estimateId = c.req.param('estimateId');
  const body = await c.req.json();
  const parsed = photoSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  // Verify estimate belongs to org
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.orgId, orgId),
  });
  
  if (!estimate) {
    return c.json({ error: 'Estimate not found' }, 404);
  }
  
  const [photo] = await db.insert(estimatePhotos).values({
    estimateId,
    roomId: parsed.roomId,
    url: parsed.url,
    annotations: parsed.annotations || [],
  }).returning();
  
  return c.json({ data: photo }, 201);
});

photosApp.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = photoSchema.partial().parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [photo] = await db.update(estimatePhotos)
    .set({
      url: parsed.url,
      annotations: parsed.annotations,
    })
    .where(eq(estimatePhotos.id, id))
    .returning();
  
  return c.json({ data: photo });
});

photosApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  await db.delete(estimatePhotos).where(eq(estimatePhotos.id, id));
  
  return c.json({ success: true });
});

export default photosApp;
