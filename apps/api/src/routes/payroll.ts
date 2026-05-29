import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { timeEntries, teamMembers } from '@crewmodo/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const payrollApp = new Hono<{ Bindings: Env; Variables: Variables }>();
payrollApp.use('*', authMiddleware);

payrollApp.get('/export', async (c) => {
  const orgId = c.get('orgId');
  const startDate = c.req.query('start');
  const endDate = c.req.query('end');
  const db = createDb(c.env.DATABASE_URL);
  
  const where = startDate && endDate 
    ? and(
        eq(timeEntries.orgId, orgId),
        gte(timeEntries.date, new Date(startDate)),
        lte(timeEntries.date, new Date(endDate))
      )
    : eq(timeEntries.orgId, orgId);
  
  const entries = await db.select({
    memberName: teamMembers.name,
    date: timeEntries.date,
    hours: timeEntries.hours,
    hourlyRate: teamMembers.hourlyRate,
    burdenRate: teamMembers.burdenRate,
    burdenedRate: timeEntries.hourlyRate,
    totalCost: timeEntries.totalCost,
    description: timeEntries.description,
  }).from(timeEntries)
  .leftJoin(teamMembers, eq(teamMembers.id, timeEntries.teamMemberId))
  .where(where)
  .orderBy(timeEntries.date);
  
  const csv = [
    'Employee,Date,Hours,Hourly Rate,Burden %,Burdened Rate,Total Pay,Description',
    ...entries.map(e => [
      e.memberName || '',
      e.date.toISOString().split('T')[0],
      e.hours,
      e.hourlyRate,
      e.burdenRate,
      e.burdenedRate,
      e.totalCost,
      `"${(e.description || '').replace(/"/g, '""')}"`
    ].join(','))
  ].join('\n');
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="payroll-${startDate || 'all'}-${endDate || 'all'}.csv"`,
    },
  });
});

export default payrollApp;
