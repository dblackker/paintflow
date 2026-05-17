import { Hono } from 'hono';
import { createSession } from '../auth';
import type { Env } from '../types';
import { createDb } from '@paintflow/db';
import { users, organizations, memberships } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';

const auth = new Hono<{ Bindings: Env }>();

// POST /v1/auth/magic-link
auth.post('/magic-link', async (c) => {
  const { email } = await c.req.json();
  
  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email required' }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  
  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  
  let orgId: string;
  
  if (!user) {
    // Create new user and org
    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase(),
      name: email.split('@')[0],
    }).returning();
    
    const [org] = await db.insert(organizations).values({
      name: `${newUser.name}'s Painting Co`,
      slug: `org-${crypto.randomUUID().slice(0, 8)}`,
    }).returning();
    
    await db.insert(memberships).values({
      userId: newUser.id,
      orgId: org.id,
      role: 'owner',
    });
    
    user = newUser;
    orgId = org.id;
  } else {
    // Get user's org
    const membership = await db.query.memberships.findFirst({
      where: eq(memberships.userId, user.id),
    });
    orgId = membership?.orgId || '';
  }
  
  // Generate magic link token
  const token = crypto.randomUUID();
  
  // Store in KV with 15 min TTL
  await c.env.KV.put(
    `magic:${token}`,
    JSON.stringify({ email, userId: user.id, orgId }),
    { expirationTtl: 900 }
  );
  
  // TODO: Send email via Resend
  // const magicLink = `${c.env.APP_URL}/auth/verify?token=${token}`;
  
  return c.json({ 
    success: true, 
    message: 'Magic link sent to email',
    devToken: token // Remove in production
  });
});

// GET /v1/auth/verify?token=...
auth.get('/verify', async (c) => {
  const token = c.req.query('token');
  
  if (!token) {
    return c.json({ error: 'Token required' }, 400);
  }
  
  const data = await c.env.KV.get(`magic:${token}`);
  
  if (!data) {
    return c.json({ error: 'Invalid or expired token' }, 400);
  }
  
  const { email, userId, orgId } = JSON.parse(data);
  
  await c.env.KV.delete(`magic:${token}`);
  
  const sessionToken = await createSession(c.env, userId, orgId, email);
  
  c.header('Set-Cookie', `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
  
  return c.redirect('/dashboard');
});

// POST /v1/auth/logout
auth.post('/logout', async (c) => {
  const token = c.req.cookie('session');
  
  if (token) {
    await c.env.KV.delete(`session:${token}`);
  }
  
  c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  
  return c.json({ success: true });
});

export default auth;
