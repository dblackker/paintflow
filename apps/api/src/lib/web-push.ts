import { createDb } from '@paintflow/db';
import { notificationEvents, pushSubscriptions } from '@paintflow/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { Env } from '../types';

type NotificationInput = {
  orgId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  priority?: 'normal' | 'high';
  sourceType?: string | null;
  sourceId?: string | null;
  leadId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function base64Url(input: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function signVapidJwt(env: Env, endpoint: string) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const aud = new URL(endpoint).origin;
  const sub = env.VAPID_SUBJECT || 'mailto:admin@paintflow.app';
  const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64Url(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    sub,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64Url(signature)}`;
}

export async function sendWebPush(env: Env, endpoint: string) {
  const token = await signVapidJwt(env, endpoint);
  if (!token || !env.VAPID_PUBLIC_KEY) return { skipped: true };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
      TTL: '2419200',
      Urgency: 'normal',
    },
  });

  return { ok: response.ok, status: response.status };
}

export async function createNotificationAndPush(env: Env, input: NotificationInput) {
  const db = createDb(env.DATABASE_URL);
  const [event] = await db.insert(notificationEvents).values({
    orgId: input.orgId,
    type: input.type,
    title: input.title,
    body: input.body || null,
    href: input.href || null,
    priority: input.priority || 'normal',
    sourceType: input.sourceType || null,
    sourceId: input.sourceId || null,
    leadId: input.leadId || null,
    metadata: input.metadata || {},
  }).returning();

  const subscriptions = await db.select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.orgId, input.orgId), isNull(pushSubscriptions.disabledAt)));

  await Promise.all(subscriptions.map(async (subscription) => {
    const result = await sendWebPush(env, subscription.endpoint);
    if ('status' in result && [404, 410].includes(result.status || 0)) {
      await db.update(pushSubscriptions)
        .set({ disabledAt: new Date(), updatedAt: new Date() })
        .where(eq(pushSubscriptions.id, subscription.id));
    }
  }));

  return event;
}
