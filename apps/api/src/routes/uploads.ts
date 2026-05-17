import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

uploads.use('*', authMiddleware);

// POST /v1/uploads/receipt
uploads.post('/receipt', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const jobId = formData.get('jobId') as string;
  
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }
  
  // Upload to R2
  const key = `receipts/${jobId}/${Date.now()}-${file.name}`;
  
  // await c.env.R2.put(key, file.stream(), {
  //   httpMetadata: {
  //     contentType: file.type,
  //   },
  // });
  
  const url = `https://cdn.paintflow.app/${key}`;
  
  return c.json({ 
    success: true,
    url,
    key,
  });
});

// GET /v1/uploads/:key
uploads.get('/:key', async (c) => {
  const key = c.req.param('key');
  
  // const object = await c.env.R2.get(key);
  // if (!object) return c.json({ error: 'Not found' }, 404);
  // 
  // return new Response(object.body, {
  //   headers: {
  //     'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
  //   },
  // });
  
  return c.json({ url: `https://cdn.paintflow.app/${key}` });
});

export default uploads;
