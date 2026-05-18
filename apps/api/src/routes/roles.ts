import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { memberships, roles, userRoles, users } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const rolesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
rolesApp.use('*', authMiddleware);

const DEFAULT_ROLES = [
  {
    name: 'Owner',
    permissions: ['all'],
    isSystem: true,
  },
  {
    name: 'Admin',
    permissions: ['manage_team', 'log_time_for_others', 'view_all_time', 'view_reports', 'manage_settings'],
    isSystem: true,
  },
  {
    name: 'Foreman',
    permissions: ['log_time_for_others', 'view_all_time', 'view_reports'],
    isSystem: true,
  },
  {
    name: 'Crew',
    permissions: ['log_own_time'],
    isSystem: true,
  },
];

rolesApp.post('/seed', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const existing = await db.query.roles.findFirst({
    where: eq(roles.orgId, orgId),
  });
  
  if (existing) {
    return c.json({ error: 'Roles already seeded' }, 400);
  }
  
  const created = await db.insert(roles).values(
    DEFAULT_ROLES.map(r => ({ ...r, orgId, permissions: r.permissions }))
  ).returning();
  
  return c.json({ data: created });
});

rolesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const data = await db.query.roles.findMany({
    where: eq(roles.orgId, orgId),
  });
  
  return c.json({ data });
});

const assignSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

rolesApp.post('/assign', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const data = assignSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  // Remove existing roles for user
  await db.delete(userRoles).where(
    and(eq(userRoles.userId, data.userId), eq(userRoles.orgId, orgId))
  );
  
  // Assign new role
  const [assigned] = await db.insert(userRoles).values({
    userId: data.userId,
    roleId: data.roleId,
    orgId,
  }).returning();
  
  return c.json({ data: assigned });
});

rolesApp.get('/users', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const data = await db.select({
    userId: users.id,
    email: users.email,
    name: users.name,
    roleId: userRoles.roleId,
    roleName: roles.name,
  }).from(users)
  .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, orgId)))
  .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.orgId, orgId)))
  .leftJoin(roles, eq(roles.id, userRoles.roleId));
  
  return c.json({ data });
});

export default rolesApp;
