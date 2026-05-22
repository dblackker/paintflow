import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';

function clientIp(c: Context<{ Bindings: Env; Variables: Variables }>) {
  return c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

export async function requestLogging(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);

  try {
    await next();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'api.request.error',
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') || '',
      origin: c.req.header('origin') || '',
      authSource: c.get('authSource') || 'none',
      userId: c.get('userId') || null,
      orgId: c.get('orgId') || null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    throw error;
  } finally {
    const status = c.res.status;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    console[level](JSON.stringify({
      event: 'api.request',
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') || '',
      origin: c.req.header('origin') || '',
      referer: c.req.header('referer') || '',
      authSource: c.get('authSource') || 'none',
      userId: c.get('userId') || null,
      orgId: c.get('orgId') || null,
      durationMs: Date.now() - startedAt,
    }));
  }
}
