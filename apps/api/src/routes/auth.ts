import { Hono } from 'hono';
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
  
  return c.redirect(`${c.env.PUBLIC_URL}${isNewUser ? '/onboarding?welcome=1' : '/dashboard'}`);
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
