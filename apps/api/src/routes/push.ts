import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { pushSubscriptions } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const push = new Hono<{ Bindings: Env; Variables: Variables }>();

push.use('*', authMiddleware);

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

push.get('/vapid-public-key', (c) => {
  return c.json({
    data: {
      publicKey: c.env.VAPID_PUBLIC_KEY || null,
      enabled: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
    },
  });
});

push.post('/subscriptions', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const parsed = subscriptionSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.pushSubscriptions.findFirst({
    where: eq(pushSubscriptions.endpoint, parsed.data.endpoint),
  });

  if (existing) {
    const [subscription] = await db.update(pushSubscriptions)
      .set({
        orgId,
        userId,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: c.req.header('User-Agent') || null,
        disabledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pushSubscriptions.id, existing.id))
      .returning();
    return c.json({ data: subscription });
  }

  const [subscription] = await db.insert(pushSubscriptions).values({
    orgId,
    userId,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: c.req.header('User-Agent') || null,
  }).returning();

  return c.json({ data: subscription }, 201);
});

push.delete('/subscriptions', async (c) => {
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  await db.update(pushSubscriptions)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));

  return c.json({ data: { disabled: true } });
});

export default push;
