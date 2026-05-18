import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { expenses } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

uploads.use('*', authMiddleware);

// POST /v1/uploads/receipt
uploads.post('/receipt', async (c) => {
  const orgId = c.get('orgId');
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const jobId = formData.get('jobId') as string;
  const amount = formData.get('amount') as string;
  const category = formData.get('category') as string;
  const description = formData.get('description') as string;
  
  if (!file || !jobId || !amount) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  
  // Upload to R2
  const key = `receipts/${jobId}/${Date.now()}-${file.name}`;
  
  // await c.env.R2.put(key, file.stream(), {
  //   httpMetadata: { contentType: file.type },
  // });
  
  const url = `https://cdn.paintflow.app/${key}`;
  
  // Create expense record
  const db = createDb(c.env.DATABASE_URL);
  const [expense] = await db.insert(expenses).values({
    orgId,
    jobId,
    amount: amount,
    category: category || 'materials',
    description: description || '',
    receiptUrl: url,
    date: new Date(),
  }).returning();
  
  return c.json({ 
    success: true,
    url,
    key,
    expense,
  });
});

// GET /v1/uploads/:key
uploads.get('/:key', async (c) => {
  const key = c.req.param('key');
  return c.json({ url: `https://cdn.paintflow.app/${key}` });
});

// POST /v1/uploads/photo
uploads.post('/photo', async (c) => {
  const orgId = c.get('orgId');
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const jobId = formData.get('jobId') as string;
  const caption = formData.get('caption') as string;
  const type = formData.get('type') as string || 'progress';
  
  if (!file || !jobId) {
    return c.json({ error: 'Missing file or jobId' }, 400);
  }
  
  // Upload to R2 (mock for now)
  const key = `photos/${jobId}/${Date.now()}-${file.name}`;
  const url = `https://cdn.paintflow.app/${key}`;
  
  // Save to DB
  const { jobPhotos } = await import('@paintflow/db/schema');
  const db = createDb(c.env.DATABASE_URL);
  const [photo] = await db.insert(jobPhotos).values({
    orgId,
    jobId,
    url,
    key,
    caption,
    type,
  }).returning();
  
  return c.json({ success: true, photo });
});

// GET /v1/uploads/photos/:jobId
uploads.get('/photos/:jobId', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('jobId');
  const { jobPhotos } = await import('@paintflow/db/schema');
  const { eq, and } = await import('drizzle-orm');
  
  const db = createDb(c.env.DATABASE_URL);
  const photos = await db.select().from(jobPhotos)
    .where(and(eq(jobPhotos.orgId, orgId), eq(jobPhotos.jobId, jobId)))
    .orderBy(jobPhotos.createdAt);
  
  return c.json({ data: photos });
});

export default uploads;
