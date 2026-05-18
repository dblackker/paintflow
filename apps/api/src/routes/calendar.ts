import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { jobs, googleCalendarConnections } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createOAuthState, consumeOAuthState } from '../auth';

const calendar = new Hono<{ Bindings: Env; Variables: Variables }>();

calendar.use('*', authMiddleware);

// GET /v1/calendar/connect
calendar.get('/connect', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const state = await createOAuthState(c.env, 'google-calendar', orgId, userId);
  
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.env.APP_URL}/v1/calendar/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /v1/calendar/callback
calendar.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  
  if (!code || !state) {
    return c.json({ error: 'Missing code or state' }, 400);
  }

  const stateData = await consumeOAuthState(c.env, 'google-calendar', state);
  if (!stateData) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }
  
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${c.env.APP_URL}/v1/calendar/callback`,
        grant_type: 'authorization_code',
      }),
    });
    
    const orgId = stateData.orgId;
    const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };
    
    const db = createDb(c.env.DATABASE_URL);
    await db.insert(googleCalendarConnections)
      .values({
        orgId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      })
      .onConflictDoUpdate({
        target: googleCalendarConnections.orgId,
        set: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          updatedAt: new Date(),
        },
      });
    
    return c.redirect(`${c.env.PUBLIC_URL}/settings?calendar_connected=true`);
  } catch (err) {
    console.error('Google Calendar callback error:', err);
    return c.json({ error: 'Connection failed' }, 500);
  }
});

// GET /v1/calendar/status
calendar.get('/status', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const connection = await db.query.googleCalendarConnections.findFirst({
    where: eq(googleCalendarConnections.orgId, orgId),
  });
  
  return c.json({ connected: !!connection });
});

// GET /v1/calendar/events
calendar.get('/events', async (c) => {
  const orgId = c.get('orgId');
  const { timeMin, timeMax } = c.req.query();
  
  const db = createDb(c.env.DATABASE_URL);
  const connection = await db.query.googleCalendarConnections.findFirst({
    where: eq(googleCalendarConnections.orgId, orgId),
  });
  
  let googleEvents = [];
  
  if (connection) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${connection.calendarId}/events?` +
        new URLSearchParams({
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
        }),
        {
          headers: { Authorization: `Bearer ${connection.accessToken}` },
        }
      );
      
      if (res.ok) {
        const data = await res.json() as { items?: unknown[] };
        googleEvents = data.items || [];
      }
    } catch (err) {
      console.error('Failed to fetch Google events:', err);
    }
  }
  
  const dbJobs = await db.select().from(jobs).where(eq(jobs.orgId, orgId));
  
  return c.json({ data: { google: googleEvents, jobs: dbJobs } });
});

// POST /v1/calendar/sync-job
calendar.post('/sync-job', async (c) => {
  const orgId = c.get('orgId');
  const { jobId, startTime, endTime } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  
  if (!job || job.orgId !== orgId) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  const connection = await db.query.googleCalendarConnections.findFirst({
    where: eq(googleCalendarConnections.orgId, orgId),
  });
  
  if (!connection) {
    return c.json({ error: 'Calendar not connected' }, 400);
  }
  
  try {
    const eventRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${connection.calendarId}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: job.name,
          description: `Painting job - Budget: $${job.budget}`,
          start: { dateTime: startTime },
          end: { dateTime: endTime },
        }),
      }
    );
    
    const event = await eventRes.json() as { id: string };
    return c.json({ success: true, eventId: event.id });
  } catch (err) {
    console.error('Failed to create calendar event:', err);
    return c.json({ error: 'Failed to sync' }, 500);
  }
});

export default calendar;
