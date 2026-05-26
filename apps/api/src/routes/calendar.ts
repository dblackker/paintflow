import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { jobs, googleCalendarConnections, orgSettings } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createOAuthState, consumeOAuthState } from '../auth';
import { readPreferenceObject } from '../lib/legal-settings';

const calendar = new Hono<{ Bindings: Env; Variables: Variables }>();

calendar.use('*', authMiddleware);

const zipSchema = z.preprocess(
  (value) => firstZip(typeof value === 'string' ? value : ''),
  z.string().regex(/^\d{5}$/)
);
const weatherSettingsSchema = z.object({
  zipCode: zipSchema,
}).strict();

const weatherCacheSeconds = 30 * 60;

function firstZip(value?: string | null) {
  return String(value || '').match(/\b\d{5}(?:-\d{4})?\b/)?.[0]?.slice(0, 5) || '';
}

function weatherPreferences(preferences: Record<string, unknown>, userId?: string) {
  const raw = preferences.calendarWeather && typeof preferences.calendarWeather === 'object' && !Array.isArray(preferences.calendarWeather)
    ? preferences.calendarWeather as Record<string, unknown>
    : {};
  const byUser = raw.byUser && typeof raw.byUser === 'object' && !Array.isArray(raw.byUser)
    ? raw.byUser as Record<string, unknown>
    : {};
  const userZip = userId && typeof byUser[userId] === 'string' ? firstZip(byUser[userId] as string) : '';
  return {
    byUser,
    userZip,
    defaultZip: typeof raw.defaultZip === 'string' ? firstZip(raw.defaultZip) : '',
  };
}

async function geocodeZip(zipCode: string) {
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({
    name: zipCode,
    count: '1',
    language: 'en',
    format: 'json',
    countryCode: 'US',
  })}`);
  if (!response.ok) return null;
  const payload = await response.json() as {
    results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country_code?: string }>;
  };
  const result = payload.results?.find((item) => item.country_code === 'US') || payload.results?.[0];
  if (!result?.latitude || !result?.longitude) return null;
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    label: [result.name, result.admin1].filter(Boolean).join(', '),
  };
}

async function fetchForecastForZip(zipCode: string) {
  const location = await geocodeZip(zipCode);
  if (!location) return null;
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    forecast_days: '10',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_gusts_10m_max',
    ].join(','),
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) return null;
  const payload = await response.json() as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      precipitation_sum?: number[];
      wind_gusts_10m_max?: number[];
    };
  };
  const times = payload.daily?.time || [];
  return {
    zipCode,
    label: location.label,
    days: times.map((date, index) => ({
      date,
      weatherCode: payload.daily?.weather_code?.[index] ?? null,
      high: payload.daily?.temperature_2m_max?.[index] ?? null,
      low: payload.daily?.temperature_2m_min?.[index] ?? null,
      precipProbability: payload.daily?.precipitation_probability_max?.[index] ?? null,
      precipAmount: payload.daily?.precipitation_sum?.[index] ?? null,
      windGust: payload.daily?.wind_gusts_10m_max?.[index] ?? null,
    })),
  };
}

async function cachedForecastForZip(env: Env, zipCode: string) {
  const key = `weather:forecast:v1:${zipCode}`;
  try {
    const cached = await env.KV.get(key, 'json') as Awaited<ReturnType<typeof fetchForecastForZip>> | null;
    if (cached?.zipCode === zipCode && Array.isArray(cached.days)) return cached;
  } catch {
    // Weather should remain best-effort if KV is unavailable locally.
  }

  const forecast = await fetchForecastForZip(zipCode);
  if (forecast) {
    try {
      await env.KV.put(key, JSON.stringify(forecast), { expirationTtl: weatherCacheSeconds });
    } catch {
      // Ignore cache writes; the live forecast is still usable.
    }
  }
  return forecast;
}

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

calendar.get('/weather-settings', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const db = createDb(c.env.DATABASE_URL);
  let settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  if (!settings) {
    [settings] = await db.insert(orgSettings).values({ orgId }).returning();
  }
  const preferences = readPreferenceObject(settings.businessHours);
  const weather = weatherPreferences(preferences, userId);
  const businessZip = firstZip(settings.address);
  return c.json({
    data: {
      zipCode: weather.userZip || weather.defaultZip || businessZip,
      businessZip,
    },
  });
});

calendar.put('/weather-settings', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const parsed = weatherSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const preferences = readPreferenceObject(existing?.businessHours);
  const current = weatherPreferences(preferences, userId);
  const byUser = userId ? { ...current.byUser, [userId]: parsed.data.zipCode } : current.byUser;
  const businessHours = {
    ...preferences,
    calendarWeather: {
      defaultZip: current.defaultZip || firstZip(existing?.address),
      byUser,
    },
  };

  await db.insert(orgSettings)
    .values({ orgId, businessHours })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { businessHours, updatedAt: new Date() },
    });

  return c.json({ data: { zipCode: parsed.data.zipCode, businessZip: firstZip(existing?.address) } });
});

calendar.get('/weather', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestedZip = firstZip(c.req.query('zip'));
  const jobZips = Array.from(new Set(String(c.req.query('jobZips') || '')
    .split(',')
    .map((zip) => firstZip(zip))
    .filter(Boolean)))
    .slice(0, 8);

  const db = createDb(c.env.DATABASE_URL);
  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  const preferences = readPreferenceObject(settings?.businessHours);
  const weather = weatherPreferences(preferences, userId);
  const businessZip = firstZip(settings?.address);
  const primaryZip = requestedZip || weather.userZip || weather.defaultZip || businessZip || jobZips[0] || '';

  if (!primaryZip) {
    return c.json({ data: { zipCode: '', businessZip, forecast: null, jobForecasts: [] } });
  }

  const uniqueZips = Array.from(new Set([primaryZip, ...jobZips])).slice(0, 8);
  const forecasts = await Promise.all(uniqueZips.map(async (zipCode) => cachedForecastForZip(c.env, zipCode).catch(() => null)));
  const forecastByZip = new Map(forecasts.filter(Boolean).map((forecast) => [forecast!.zipCode, forecast!]));

  return c.json({
    data: {
      zipCode: primaryZip,
      businessZip,
      forecast: forecastByZip.get(primaryZip) || null,
      jobForecasts: jobZips.map((zipCode) => forecastByZip.get(zipCode)).filter(Boolean),
    },
  });
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
