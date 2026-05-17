import { Hono } from 'hono';
import { createSession } from '../auth';
import type { Env } from '../types';

const auth = new Hono<{ Bindings: Env }>();

// POST /v1/auth/magic-link
auth.post('/magic-link', async (c) => {
  const { email } = await c.req.json();
  
  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email required' }, 400);
  }
  
  // TODO: Lookup or create user in DB
  // const user = await findOrCreateUser(email);
  // For now, mock user/org IDs
  const userId = '00000000-0000-0000-0000-000000000001';
  const orgId = '00000000-0000-0000-0000-000000000001';
  
  // Generate magic link token
  const token = crypto.randomUUID();
  
  // Store in KV with 15 min TTL
  await c.env.KV.put(
    `magic:${token}`,
    JSON.stringify({ email, userId, orgId }),
    { expirationTtl: 900 }
  );
  
  // TODO: Send email via Resend
  // const magicLink = `${c.env.APP_URL}/auth/verify?token=${token}`;
  // await resend.emails.send({...});
  
  // For dev, return token in response
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
  
  // Verify token from KV
  const data = await c.env.KV.get(`magic:${token}`);
  
  if (!data) {
    return c.json({ error: 'Invalid or expired token' }, 400);
  }
  
  const { email, userId, orgId } = JSON.parse(data);
  
  // Delete used token
  await c.env.KV.delete(`magic:${token}`);
  
  // Create session
  const sessionToken = await createSession(c.env, userId, orgId, email);
  
  // Set cookie
  c.header('Set-Cookie', `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
  
  // Redirect to app
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
