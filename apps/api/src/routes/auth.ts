import { Hono } from 'hono';
import { createSession } from '../auth';

const auth = new Hono();

// POST /v1/auth/magic-link
auth.post('/magic-link', async (c) => {
  const { email } = await c.req.json();
  
  if (!email) {
    return c.json({ error: 'Email required' }, 400);
  }
  
  // TODO: Lookup or create user
  // const user = await findOrCreateUser(email);
  
  // Generate magic link token
  const token = crypto.randomUUID();
  
  // TODO: Store in KV with TTL 900s
  // await c.env.KV.put(`magic:${token}`, JSON.stringify({ email }), { expirationTtl: 900 });
  
  // TODO: Send email via Resend
  // await resend.emails.send({... magic link ...});
  
  return c.json({ success: true, message: 'Magic link sent' });
});

// GET /v1/auth/verify?token=...
auth.get('/verify', async (c) => {
  const token = c.req.query('token');
  
  if (!token) {
    return c.json({ error: 'Token required' }, 400);
  }
  
  // TODO: Verify token from KV
  // const data = await c.env.KV.get(`magic:${token}`);
  // if (!data) return c.json({ error: 'Invalid or expired token' }, 400);
  
  // TODO: Create user/org if new, create session
  // const sessionToken = await createSession(userId, orgId);
  
  // Set cookie
  // c.header('Set-Cookie', `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
  
  return c.redirect('/dashboard');
});

export default auth;
