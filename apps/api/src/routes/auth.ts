import { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createSession } from '../auth';
import type { Env } from '../types';
import { createDb } from '@paintflow/db';
import {
  users,
  organizations,
  memberships,
  orgSettings,
  leadSources,
  productionRates,
  estimateTemplates,
  messageTemplates,
  roles,
  userRoles,
} from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from '../lib/email';

const auth = new Hono<{ Bindings: Env }>();

const DEFAULT_LEAD_SOURCES = [
  { name: 'Website form', type: 'website', cost: '0.00' },
  { name: 'Google Business Profile', type: 'organic', cost: '0.00' },
  { name: 'Google Ads', type: 'paid_search', cost: '0.00' },
  { name: 'Referral', type: 'referral', cost: '0.00' },
  { name: 'Repeat customer', type: 'repeat', cost: '0.00' },
];

const DEFAULT_PRODUCTION_RATES = [
  { category: 'walls', surfaceType: 'interior drywall', unit: 'sqft', ratePerHour: '400.00', hourlyRate: '65.00', prepMultiplier: '1.00', coats: 2, description: 'Interior walls, brush and roll, standard prep' },
  { category: 'ceilings', surfaceType: 'interior drywall', unit: 'sqft', ratePerHour: '300.00', hourlyRate: '65.00', prepMultiplier: '1.10', coats: 2, description: 'Flat ceilings, standard prep' },
  { category: 'trim', surfaceType: 'painted wood', unit: 'linear_ft', ratePerHour: '80.00', hourlyRate: '65.00', prepMultiplier: '1.25', coats: 2, description: 'Baseboards, casing, and crown trim' },
  { category: 'doors', surfaceType: 'interior wood', unit: 'each', ratePerHour: '4.00', hourlyRate: '65.00', prepMultiplier: '1.15', coats: 2, description: 'Interior slab door, both sides' },
  { category: 'cabinets', surfaceType: 'wood cabinet fronts', unit: 'each', ratePerHour: '0.50', hourlyRate: '75.00', prepMultiplier: '1.60', coats: 2, description: 'Cabinet door or drawer front with heavy prep' },
  { category: 'exterior_siding', surfaceType: 'exterior siding', unit: 'sqft', ratePerHour: '200.00', hourlyRate: '75.00', prepMultiplier: '1.35', coats: 2, description: 'Exterior siding, spray and back-roll where needed' },
  { category: 'exterior_soffit', surfaceType: 'wood or aluminum', unit: 'sqft', ratePerHour: '125.00', hourlyRate: '75.00', prepMultiplier: '1.35', coats: 2, description: 'Exterior soffits' },
  { category: 'exterior_fascia', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: '55.00', hourlyRate: '75.00', prepMultiplier: '1.35', coats: 2, description: 'Exterior fascia boards' },
  { category: 'exterior_trim', surfaceType: 'window and door trim', unit: 'linear_ft', ratePerHour: '50.00', hourlyRate: '75.00', prepMultiplier: '1.35', coats: 2, description: 'Exterior window and door trim' },
  { category: 'exterior_corner_boards', surfaceType: 'wood or composite', unit: 'linear_ft', ratePerHour: '50.00', hourlyRate: '75.00', prepMultiplier: '1.35', coats: 2, description: 'Exterior corner boards' },
];

const DEFAULT_ESTIMATE_TEMPLATES = [
  {
    name: 'Interior Room Repaint',
    description: 'Standard room with walls, ceiling, trim, and doors',
    category: 'room',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Room',
      roomType: 'standard_room',
      items: [
        { category: 'walls', quantity: 420, prepLevel: 'standard' },
        { category: 'ceilings', quantity: 160, prepLevel: 'standard' },
        { category: 'trim', quantity: 55, prepLevel: 'standard' },
        { category: 'doors', quantity: 1, prepLevel: 'standard' },
      ],
    }],
    packages: [
      { name: 'Good', multiplier: 0.9, description: 'Standard coverage and prep' },
      { name: 'Better', multiplier: 1, description: 'Recommended paint and prep' },
      { name: 'Best', multiplier: 1.18, description: 'Premium materials and touch-up allowance' },
    ],
  },
  {
    name: 'Exterior Repaint',
    description: 'Exterior siding with trim and doors',
    category: 'full_estimate',
    isShared: true,
    isSmart: true,
    rooms: [{
      name: 'Exterior',
      roomType: 'exterior',
      items: [
        { category: 'exterior_siding', quantity: 1800, prepLevel: 'heavy' },
        { category: 'trim', quantity: 240, prepLevel: 'heavy' },
        { category: 'doors', quantity: 2, prepLevel: 'standard' },
      ],
    }],
  },
];

const DEFAULT_MESSAGE_TEMPLATES = [
  {
    type: 'estimate_followup_1',
    channel: 'email',
    subject: 'Following up on your PaintFlow estimate',
    body: 'Hi {{customer_name}}, checking in on the painting estimate we sent. Reply here with any questions or approve it from your customer portal.',
    delayDays: 2,
  },
  {
    type: 'review_request',
    channel: 'email',
    subject: 'How did your painting project go?',
    body: 'Hi {{customer_name}}, thanks for choosing us. If you are happy with the work, would you leave us a quick review?',
    delayDays: 1,
  },
];

const DEFAULT_ROLES = [
  { name: 'Owner', permissions: ['*'], isSystem: true },
  { name: 'Estimator', permissions: ['manage_leads', 'manage_estimates', 'view_jobs'], isSystem: true },
  { name: 'Foreman', permissions: ['view_jobs', 'log_time', 'upload_photos', 'create_change_orders'], isSystem: true },
  { name: 'Crew', permissions: ['view_assigned_jobs', 'log_time', 'upload_photos'], isSystem: true },
];

const MAGIC_LINK_WINDOW_SECONDS = 3600;
const GOLDEN_DEMO_EMAIL = 'demo@goldenbrush.paintflow.local';

function sessionCookie(value: string, env: Env, maxAge: number) {
  const isCrossSiteDemo = env.ENVIRONMENT === 'demo';
  const parts = [
    `session=${value}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAge}`,
    `SameSite=${isCrossSiteDemo ? 'None' : 'Lax'}`,
  ];

  if (env.ENVIRONMENT === 'production' || isCrossSiteDemo) {
    parts.push('Secure');
  }

  if (env.COOKIE_DOMAIN) {
    parts.push(`Domain=${env.COOKIE_DOMAIN}`);
  }

  return parts.join('; ');
}

function parseLimit(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function magicLinkLimits(env: Env) {
  const isDevelopment = env.ENVIRONMENT === 'development';
  return {
    email: parseLimit(env.MAGIC_LINK_EMAIL_LIMIT, isDevelopment ? 100 : 10),
    ip: parseLimit(env.MAGIC_LINK_IP_LIMIT, isDevelopment ? 300 : 60),
  };
}

function canUseGoldenDemoLogin(env: Env, email: string) {
  return email === GOLDEN_DEMO_EMAIL && ['development', 'demo'].includes(env.ENVIRONMENT);
}

function safeRedirectUrl(env: Env, value: string | null | undefined, fallback = '/dashboard') {
  if (!value) return `${env.PUBLIC_URL}${fallback}`;
  try {
    const url = new URL(value, env.PUBLIC_URL);
    const publicUrl = new URL(env.PUBLIC_URL);
    const isPublicOrigin = url.origin === publicUrl.origin;
    const isLocalDev = env.ENVIRONMENT !== 'production'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && Number(url.port || 0) >= 4321
      && Number(url.port || 0) <= 4399;
    if (isPublicOrigin || isLocalDev) return url.toString();
  } catch {
    // Fall through to the configured app URL.
  }
  return `${env.PUBLIC_URL}${fallback}`;
}

function redirectWithLocation(location: string, headers: HeadersInit = {}, status = 302) {
  return new Response(null, {
    status,
    headers: {
      ...headers,
      Location: location,
    },
  });
}

function clientIp(c: Context<{ Bindings: Env }>) {
  return c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function minutesUntil(timestamp: number) {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 60000));
}

async function checkMagicLinkBucket(env: Env, key: string, limit: number) {
  const now = Date.now();
  const existing = await env.KV.get(key);
  let state = { count: 0, resetAt: now + MAGIC_LINK_WINDOW_SECONDS * 1000 };

  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { count?: number; resetAt?: number };
      if (typeof parsed.count === 'number' && typeof parsed.resetAt === 'number' && parsed.resetAt > now) {
        state = { count: parsed.count, resetAt: parsed.resetAt };
      }
    } catch {
      const parsedCount = Number.parseInt(existing, 10);
      if (Number.isFinite(parsedCount)) {
        state = { count: parsedCount, resetAt: now + MAGIC_LINK_WINDOW_SECONDS * 1000 };
      }
    }
  }

  if (state.count >= limit) {
    return { allowed: false, resetAt: state.resetAt, retryAfterMinutes: minutesUntil(state.resetAt) };
  }

  state.count += 1;
  await env.KV.put(key, JSON.stringify(state), {
    expirationTtl: Math.max(60, Math.ceil((state.resetAt - now) / 1000)),
  });

  return { allowed: true, resetAt: state.resetAt, retryAfterMinutes: 0 };
}

async function createGoldenDemoSession(c: Context<{ Bindings: Env }>, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!canUseGoldenDemoLogin(c.env, normalizedEmail)) {
    return { error: 'Demo login is not available in this environment.', status: 404 as const };
  }

  const db = createDb(c.env.DATABASE_URL);
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    return {
      error: 'Golden demo user has not been seeded in this database yet.',
      code: 'DEMO_USER_NOT_SEEDED',
      status: 404 as const,
    };
  }

  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, user.id),
  });

  if (!membership?.orgId) {
    return {
      error: 'Golden demo user is missing an organization membership.',
      code: 'DEMO_USER_MISSING_MEMBERSHIP',
      status: 409 as const,
    };
  }

  const sessionToken = await createSession(c.env, user.id, membership.orgId, normalizedEmail);
  c.header('Set-Cookie', sessionCookie(sessionToken, c.env, 604800));

  return {
    sessionToken,
    user,
    membership,
    status: 200 as const,
  };
}

async function seedWorkspaceDefaults(
  db: ReturnType<typeof createDb>,
  orgId: string,
  userId: string,
  email: string,
  companyName: string
) {
  await db.insert(orgSettings).values({
    orgId,
    companyName,
    email,
    defaultLaborRate: '65.00',
    materialMarkupPercent: '30.00',
    salesTaxRate: '0.0920',
    depositPercent: '50.00',
    estimateValidDays: 30,
    paymentTerms: '50% deposit, balance due on completion',
    acceptChecks: true,
    acceptCash: true,
  });

  await db.insert(leadSources).values(
    DEFAULT_LEAD_SOURCES.map((source) => ({ orgId, ...source }))
  );

  await db.insert(productionRates).values(
    DEFAULT_PRODUCTION_RATES.map((rate) => ({ orgId, ...rate }))
  );

  await db.insert(estimateTemplates).values(
    DEFAULT_ESTIMATE_TEMPLATES.map((template) => ({
      orgId,
      createdBy: userId,
      ...template,
    }))
  );

  await db.insert(messageTemplates).values(
    DEFAULT_MESSAGE_TEMPLATES.map((template) => ({
      orgId,
      ...template,
    }))
  );

  const seededRoles = await db.insert(roles).values(
    DEFAULT_ROLES.map((role) => ({
      orgId,
      ...role,
    }))
  ).returning();

  const ownerRole = seededRoles.find((role) => role.name === 'Owner');
  if (ownerRole) {
    await db.insert(userRoles).values({
      orgId,
      userId,
      roleId: ownerRole.id,
    });
  }
}

function magicLinkEmailHtml(magicLink: string) {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h1 style="color: #1a1a1a;">PaintFlow</h1>
<p>Click below to sign in:</p>
<p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Sign in</a></p>
<p style="color: #999; font-size: 13px;">Link expires in 15 minutes.</p>
</body></html>`;
}

function welcomeEmailHtml(publicUrl: string) {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h1>Welcome to PaintFlow!</h1>
<p>You're all set. <a href="${publicUrl}/onboarding">Start onboarding</a></p>
</body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function verifyMagicLinkHtml(token: string, publicUrl: string, error?: string) {
  const escapedToken = escapeHtml(token);
  const loginUrl = `${publicUrl}/login`;
  const errorHtml = error
    ? `<p style="padding: 12px 14px; border-radius: 8px; background: #fef2f2; color: #991b1b;">${escapeHtml(error)}</p>`
    : '';
  const actionHtml = error
    ? `<a href="${escapeHtml(loginUrl)}" style="display: inline-flex; width: 100%; min-height: 44px; align-items: center; justify-content: center; border-radius: 999px; background: #0b57d0; color: #fff; font-size: 15px; font-weight: 600; text-decoration: none;">Request a new link</a>`
    : `<form method="post" action="/v1/auth/verify">
        <input type="hidden" name="token" value="${escapedToken}">
        <button type="submit" style="width: 100%; min-height: 44px; border: 0; border-radius: 999px; background: #0b57d0; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;">Continue</button>
      </form>`;
  const bodyCopy = error
    ? 'This sign-in link cannot be used. Request a fresh link to continue.'
    : 'Confirm this sign-in request to open your workspace.';
  const helperCopy = error
    ? 'Magic links expire after 15 minutes and can only be used once.'
    : 'This extra confirmation keeps email security scanners from using your sign-in link before you do.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in to PaintFlow</title>
</head>
<body style="margin: 0; background: #f8fafc; color: #111827; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <main style="min-height: 100vh; display: grid; place-items: center; padding: 24px;">
    <section style="width: min(100%, 420px); background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);">
      <h1 style="margin: 0 0 8px; font-size: 24px; line-height: 1.2;">Sign in to PaintFlow</h1>
      <p style="margin: 0 0 20px; color: #4b5563; line-height: 1.5;">${bodyCopy}</p>
      ${errorHtml}
      ${actionHtml}
      <p style="margin: 18px 0 0; color: #6b7280; font-size: 13px; line-height: 1.45;">${helperCopy}</p>
    </section>
  </main>
</body>
</html>`;
}

// GET /v1/auth/demo-login
auth.get('/demo-login', async (c) => {
  const email = c.req.query('email') || GOLDEN_DEMO_EMAIL;
  const result = await createGoldenDemoSession(c, email);
  const redirectUrl = safeRedirectUrl(c.env, c.req.query('redirectTo'), '/dashboard');

  if ('error' in result) {
    const loginUrl = new URL('/login', redirectUrl);
    loginUrl.searchParams.set('error', result.code || result.error);
    return redirectWithLocation(loginUrl.toString());
  }

  return redirectWithLocation(redirectUrl, {
    'Set-Cookie': sessionCookie(result.sessionToken, c.env, 604800),
  });
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
  
  const limits = magicLinkLimits(c.env);
  const emailBucket = await checkMagicLinkBucket(
    c.env,
    `ratelimit:magic-link:email:${normalizedEmail}`,
    limits.email
  );
  if (!emailBucket.allowed) {
    return c.json({
      error: `Too many sign-in links for this email. Try again in ${emailBucket.retryAfterMinutes} minute${emailBucket.retryAfterMinutes === 1 ? '' : 's'}.`,
      code: 'MAGIC_LINK_EMAIL_RATE_LIMIT',
      retryAfterMinutes: emailBucket.retryAfterMinutes,
    }, 429);
  }

  const ipBucket = await checkMagicLinkBucket(
    c.env,
    `ratelimit:magic-link:ip:${clientIp(c)}`,
    limits.ip
  );
  if (!ipBucket.allowed) {
    return c.json({
      error: `Too many sign-in requests from this network. Try again in ${ipBucket.retryAfterMinutes} minute${ipBucket.retryAfterMinutes === 1 ? '' : 's'}.`,
      code: 'MAGIC_LINK_IP_RATE_LIMIT',
      retryAfterMinutes: ipBucket.retryAfterMinutes,
    }, 429);
  }
  
  
  const db = createDb(c.env.DATABASE_URL);
  
  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (canUseGoldenDemoLogin(c.env, normalizedEmail)) {
    const demoSession = await createGoldenDemoSession(c, normalizedEmail);
    if ('error' in demoSession) {
      return c.json({
        error: demoSession.error,
        code: demoSession.code,
      }, demoSession.status);
    }

    return c.json({
      success: true,
      autoLogin: true,
      redirectUrl: `${c.env.PUBLIC_URL}/dashboard`,
    });
  }
  
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

    await seedWorkspaceDefaults(db, org.id, newUser.id, normalizedEmail, workspaceName);
    
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
  
  // Send sign-in email.
  const magicLink = `${c.env.APP_URL}/v1/auth/verify?token=${token}`;

  try {
    await sendEmail(
      c.env,
      normalizedEmail,
      'Sign in to PaintFlow',
      magicLinkEmailHtml(magicLink),
      undefined,
      {
        text: `Sign in to PaintFlow\n\nClick: ${magicLink}\n\nExpires in 15 min.`,
      }
    );
  } catch (err) {
    console.error('Failed to send email:', err);
    if (c.env.ENVIRONMENT !== 'development') {
      return c.json({ error: 'Email is not configured. Please contact support.' }, 502);
    }
  }
  
  return c.json({ 
    success: true, 
    message: 'Magic link sent to email',
    devToken: c.env.ENVIRONMENT === 'development' ? token : undefined
  });
});

async function consumeMagicLink(c: Context<{ Bindings: Env }>, token: string) {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');

  if (!token) {
    return c.html(verifyMagicLinkHtml('', c.env.PUBLIC_URL, 'Token required'), 400);
  }

  const data = await c.env.KV.get(`magic:${token}`);

  if (!data) {
    return c.html(verifyMagicLinkHtml('', c.env.PUBLIC_URL, 'This sign-in link is invalid or expired.'), 400);
  }

  const { email, userId, orgId, isNewUser } = JSON.parse(data);

  await c.env.KV.delete(`magic:${token}`);

  const sessionToken = await createSession(c.env, userId, orgId, email);

  // Send welcome email for new users (fire and forget)
  if (isNewUser) {
    sendEmail(c.env, email, 'Welcome to PaintFlow', welcomeEmailHtml(c.env.PUBLIC_URL), undefined, {
      text: `Welcome to PaintFlow!\n\nYou're all set. Start onboarding: ${c.env.PUBLIC_URL}/onboarding`,
    }).catch((error) => console.error('Failed to send welcome email:', error));
  }

  return redirectWithLocation(`${c.env.PUBLIC_URL}${isNewUser ? '/onboarding?welcome=1' : '/dashboard'}`, {
    'Set-Cookie': sessionCookie(sessionToken, c.env, 604800),
  });
}

// GET /v1/auth/verify?token=...
auth.get('/verify', async (c) => {
  const token = c.req.query('token');

  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');

  if (!token) {
    return c.html(verifyMagicLinkHtml('', c.env.PUBLIC_URL, 'Token required'), 400);
  }

  const data = await c.env.KV.get(`magic:${token}`);

  if (!data) {
    return c.html(verifyMagicLinkHtml('', c.env.PUBLIC_URL, 'This sign-in link is invalid or expired.'), 400);
  }

  return c.html(verifyMagicLinkHtml(token, c.env.PUBLIC_URL));
});

// POST /v1/auth/verify
auth.post('/verify', async (c) => {
  const body = await c.req.parseBody();
  const token = typeof body.token === 'string' ? body.token : c.req.query('token') || '';
  return consumeMagicLink(c, token);
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
