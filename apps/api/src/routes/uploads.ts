import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { expenses, jobPhotos, jobs, orgBranding } from '@crewmodo/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public logo endpoint used by customer-facing proposal links.
uploads.get('/branding/:orgId/logo', async (c) => {
  const orgId = c.req.param('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const branding = await db.query.orgBranding.findFirst({
    where: eq(orgBranding.orgId, orgId),
  });

  if (!branding?.logoUrl) {
    return c.json({ error: 'Logo not found' }, 404);
  }

  const key = `branding/${orgId}/logo.webp`;
  if (!c.env.R2) {
    if (branding.logoUrl.includes('/v1/uploads/branding/')) {
      return c.json({ error: 'Logo storage is not configured' }, 503);
    }
    return c.redirect(branding.logoUrl, 302);
  }

  const object = await c.env.R2.get(key);
  if (!object) {
    return c.json({ error: 'Logo not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
});

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
  
  const url = `https://cdn.crewmodo.com/${key}`;
  
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
  return c.json({ url: `https://cdn.crewmodo.com/${key}` });
});

// GET /v1/uploads/photos/file/:photoId
uploads.get('/photos/file/:photoId', async (c) => {
  const orgId = c.get('orgId');
  const photoId = c.req.param('photoId');
  const db = createDb(c.env.DATABASE_URL);
  const photo = await db.query.jobPhotos.findFirst({
    where: and(eq(jobPhotos.id, photoId), eq(jobPhotos.orgId, orgId)),
  });

  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  if (!c.env.R2) {
    return c.redirect(photo.url, 302);
  }

  const object = await c.env.R2.get(photo.key);
  if (!object) {
    return c.redirect(photo.url, 302);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
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
  
  const db = createDb(c.env.DATABASE_URL);
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Upload to R2 when configured, otherwise keep the existing local-dev CDN stub.
  const key = `photos/${jobId}/${Date.now()}-${file.name}`;
  if (c.env.R2) {
    await c.env.R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
  }
  const url = `https://cdn.crewmodo.com/${key}`;
  
  // Save to DB
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
  
  const db = createDb(c.env.DATABASE_URL);
  const photos = await db.select().from(jobPhotos)
    .where(and(eq(jobPhotos.orgId, orgId), eq(jobPhotos.jobId, jobId)))
    .orderBy(jobPhotos.createdAt);
  
  return c.json({ data: photos });
});

export default uploads;
