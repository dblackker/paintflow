import type { Context, Next } from 'hono';

// Middleware to set org_id for RLS
export async function tenantMiddleware(c: Context, next: Next) {
  // TODO: Get session from cookie, lookup user + active org
  const orgId = c.req.header('x-org-id') || '00000000-0000-0000-0000-000000000000';
  
  // Store in context for downstream use
  c.set('orgId', orgId);
  
  // TODO: Execute SET LOCAL app.current_org_id = '...' before DB queries
  // This would be done in db client wrapper
  
  await next();
}
