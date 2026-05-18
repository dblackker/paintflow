import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createSession } from '../auth';
import type { Env } from '../types';
import { createDb } from '@paintflow/db';
import { users, organizations, memberships } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';

const auth = new Hono<{ Bindings: Env }>();

function sessionCookie(value: string, env: Env, maxAge: number) {
  const parts = [
    `session=${value}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ];

  if (env.ENVIRONMENT === 'production') {
    parts.push('Secure');
  }

  if (env.COOKIE_DOMAIN) {
    parts.push(`Domain=${env.COOKIE_DOMAIN}`);
  }

  return parts.join('; ');
}

// Email template for magic link
const magicLinkEmail = (magicLink: string) => ({
  personalizations: [{ to: [{ email: '' }] }],
  from: { email: 'noreply@paintflow.app', name: 'PaintFlow' },
  subject: 'Sign in to PaintFlow',
  content: [
    {
      type: 'text/plain',
      value: `Sign in to PaintFlow\n\nClick: ${magicLink}\n\nExpires in 15 min.`
    },
    {
      type: 'text/html',
      value: `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h1 style="color: #1a1a1a;">PaintFlow</h1>
<p>Click below to sign in:</p>
<p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Sign in</a></p>
<p style="color: #999; font-size: 13px;">Link expires in 15 minutes.</p>
</body></html>`
    }
  ]
});

// POST /v1/auth/magic-link
auth.post('/magic-link', async (c) => {
  const { email, name, companyName } = await c.req.json();
  
  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email required' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return c.json({ error: 'Email required' }, 400);
  }

  const displayName = typeof name === 'string' && name.trim()
    ? name.trim()
    : normalizedEmail.split('@')[0];
  const workspaceName = typeof companyName === 'string' && companyName.trim()
    ? companyName.trim()
    : `${displayName}'s Painting Co`;
  
  // Rate limiting: max 3 magic links per hour per email
  const rateLimitKey = `ratelimit:magic-link:${normalizedEmail}`;
  const rateLimit = await c.env.KV.get(rateLimitKey);
  const count = rateLimit ? parseInt(rateLimit) : 0;
  if (count >= 3) {
    return c.json({ error: 'Too many requests. Try again in an hour.' }, 429);
  }
  await c.env.KV.put(rateLimitKey, (count + 1).toString(), { expirationTtl: 3600 });
  
  
  const db = createDb(c.env.DATABASE_URL);
  
  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  
  let orgId: string;
  let isNewUser = false;
  
  if (!user) {
    isNewUser = true;
    const [newUser] = await db.insert(users).values({
      email: normalizedEmail,
      name: displayName,
    }).returning();
    
    const [org] = await db.insert(organizations).values({
      name: workspaceName,
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
    const membership = await db.query.memberships.findFirst({
      where: eq(memberships.userId, user.id),
    });
    orgId = membership?.orgId || '';
  }
  
  // Generate magic link token
  const token = crypto.randomUUID();
  
  await c.env.KV.put(
    `magic:${token}`,
    JSON.stringify({ email: normalizedEmail, userId: user.id, orgId, isNewUser }),
    { expirationTtl: 900 }
  );
  
  // Send email via MailChannels
  const magicLink = `${c.env.APP_URL}/v1/auth/verify?token=${token}`;
  const emailPayload = magicLinkEmail(magicLink);
  emailPayload.personalizations[0].to[0].email = normalizedEmail;
  
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
  } catch (err) {
    console.error('Failed to send email:', err);
  }
  
  return c.json({ 
    success: true, 
    message: 'Magic link sent to email',
    devToken: c.env.ENVIRONMENT === 'development' ? token : undefined
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
  
  const { email, userId, orgId, isNewUser } = JSON.parse(data);
  
  await c.env.KV.delete(`magic:${token}`);
  
  const sessionToken = await createSession(c.env, userId, orgId, email);
  
  c.header('Set-Cookie', sessionCookie(sessionToken, c.env, 604800));
  
  // Send welcome email for new users (fire and forget)
  if (isNewUser) {
    const welcomePayload = {
      personalizations: [{ to: [{ email }] }],
      from: { email: 'welcome@paintflow.app', name: 'PaintFlow' },
      subject: 'Welcome to PaintFlow',
      content: [{
        type: 'text/html',
        value: `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h1>Welcome to PaintFlow!</h1>
<p>You're all set. <a href="${c.env.PUBLIC_URL}/onboarding">Start onboarding</a></p>
</body></html>`
      }]
    };
    
    fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(welcomePayload),
    }).catch(() => {});
  }
  
  return c.redirect(`${c.env.PUBLIC_URL}/dashboard`);
});

// POST /v1/auth/logout
auth.post('/logout', async (c) => {
  const token = getCookie(c, 'session');
  
  if (token) {
    await c.env.KV.delete(`session:${token}`);
  }
  
  c.header('Set-Cookie', sessionCookie('', c.env, 0));
  
  return c.json({ success: true });
});

export default auth;
