import type { MiddlewareHandler } from 'hono';
import { createDb } from '@crewmodo/db';
import { memberships, roles, userRoles } from '@crewmodo/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';

export function hasFinancialAccess(isOwner: boolean, permissions: unknown): boolean {
  const grants = Array.isArray(permissions) ? permissions : [];
  return isOwner || ['all', '*', 'manage_invoices', 'manage_settings']
    .some((permission) => grants.includes(permission));
}

export function requireOrgPermission(required: string[], error: string): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) return c.json({ error: 'Sign in to continue.', code: 'AUTH_REQUIRED' }, 401);
  const db = createDb(c.env.DATABASE_URL);
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
  });
  if (!membership) return c.json({ error: 'Workspace access is required.', code: 'FINANCIAL_FORBIDDEN' }, 403);
  const assignments = membership.role === 'owner' ? [] : await db.select({ permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)))
    .where(and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)));
  const permissions = assignments.flatMap((assignment) => Array.isArray(assignment.permissions) ? assignment.permissions : []);
  if (membership.role !== 'owner' && !['all', '*', ...required].some((permission) => permissions.includes(permission))) {
    return c.json({ error, code: 'PERMISSION_REQUIRED' }, 403);
  }
  await next();
  };
}

export const financialAccess = requireOrgPermission(
  ['manage_invoices', 'manage_settings'],
  'Ask an owner for permission to manage invoices and payments.',
);

export const supplierAccess = requireOrgPermission(
  ['manage_invoices', 'manage_job_costs', 'manage_settings'],
  'Ask an owner for permission to review supplier costs.',
);
