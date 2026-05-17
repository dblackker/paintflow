import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { jobs } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const calendar = new Hono<{ Bindings: Env; Variables: Variables }>();

calendar.use('*', authMiddleware);

// GET /v1/calendar/events
calendar.get('/events', async (c) => {
  const orgId = c.get('orgId');
  const { timeMin, timeMax } = c.req.query();
  
  // TODO: Fetch from Google Calendar API
  // const events = await google.calendar.events.list({
  //   calendarId: 'primary',
  //   timeMin: timeMin || new Date().toISOString(),
  //   timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  //   singleEvents: true,
  //   orderBy: 'startTime',
  // });
  
  // Combine with jobs from DB
  const db = createDb(c.env.DATABASE_URL);
  const dbJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.orgId, orgId));
  
  return c.json({ 
    data: {
      google: [], // Google Calendar events
      jobs: dbJobs,
    }
  });
});

// POST /v1/calendar/sync-job
calendar.post('/sync-job', async (c) => {
  const orgId = c.get('orgId');
  const { jobId, startTime, endTime } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
  });
  
  if (!job || job.orgId !== orgId) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  // TODO: Create Google Calendar event
  // const event = await google.calendar.events.insert({
  //   calendarId: 'primary',
  //   requestBody: {
  //     summary: job.name,
  //     description: `Painting job - Budget: $${job.budget}`,
  //     start: { dateTime: startTime },
  //     end: { dateTime: endTime },
  //   },
  // });
  
  return c.json({ 
    success: true,
    eventId: `mock_${Date.now()}`,
  });
});

// GET /v1/calendar/availability
calendar.get('/availability', async (c) => {
  const { date } = c.req.query();
  
  // TODO: Check Google Calendar for busy slots
  // Return available time slots
  
  const slots = [
    { start: '09:00', end: '11:00', available: true },
    { start: '11:00', end: '13:00', available: true },
    { start: '14:00', end: '16:00', available: false },
    { start: '16:00', end: '18:00', available: true },
  ];
  
  return c.json({ data: slots });
});

export default calendar;
