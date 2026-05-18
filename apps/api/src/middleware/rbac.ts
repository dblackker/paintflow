import type { Context, Next } from 'hono';
import { createDb } from '@paintflow/db';
import { userRoles, roles } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env } from '../types';

export async function requirePermission(permission: string) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const db = createDb(c.env.DATABASE_URL);
    
    const userRole = await db.query.userRoles.findFirst({
      where: and(eq(userRoles.userId, userId), eq(userRoles.orgId, orgId)),
      with: { role: true },
    });
    
    if (!userRole) {
      return c.json({ error: 'No role assigned' }, 403);
    }
    
    const permissions = userRole.role.permissions as string[];
    
    if (!permissions.includes(permission) && !permissions.includes('all')) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    
    c.set('userRole', userRole.role.name);
    c.set('permissions', permissions);
    
    await next();
  };
}

export async function canLogTimeFor(c: Context, teamMemberId: string): Promise<boolean> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const userRole = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.orgId, orgId)),
    with: { role: true },
  });
  
  if (!userRole) return false;
  
  const permissions = userRole.role.permissions as string[];
  
  // Owners/admins can log for anyone
  if (permissions.includes('log_time_for_others') || permissions.includes('all')) {
    return true;
  }
  
  // Check if team member is linked to user
  const { teamMembers } = await import('@paintflow/db/schema');
  const member = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.id, teamMemberId), eq(teamMembers.orgId, orgId)),
  });
  
  // For now, allow if userId matches (need to add userId to teamMembers)
  return member?.userId === userId;
}
