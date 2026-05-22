import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { getRequestSessionInfo, getSession } from '../auth';

// Middleware to set org_id for RLS and tenant isolation
export async function tenantMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const { token, source } = getRequestSessionInfo(c);
  c.set('authSource', source);
  
  if (token) {
    const session = await getSession(c.env, token);
    if (session) {
      c.set('userId', session.userId);
      c.set('orgId', session.orgId);
      c.set('session', session);
      
      // Neon HTTP does not keep a per-request Postgres session. Routes must keep
      // explicit org filters on tenant-owned data.
    }
  }
  
  // Local/test helper only. Production must derive tenant context from a session or a public token.
  if (!c.get('orgId') && c.env.ENVIRONMENT !== 'production') {
    const orgId = c.req.header('x-org-id');
    if (orgId) {
      c.set('orgId', orgId);
    }
  }
  
  await next();
}

// Middleware to require authentication
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const { token, source } = getRequestSessionInfo(c);
  c.set('authSource', source);
  
  if (!token) {
    return c.json({ error: 'Unauthorized', code: 'NO_SESSION' }, 401);
  }
  
  const session = await getSession(c.env, token);
  
  if (!session) {
    return c.json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' }, 401);
  }
  
  c.set('userId', session.userId);
  c.set('orgId', session.orgId);
  c.set('session', session);
  
  await next();
}
